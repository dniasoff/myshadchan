---
baseline_commit: 32fa979128ece8cf4cbfcb3c50b1307b46f8c373
---

# Story 7.4: Any pairing may hold a private thread

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any user,
I want a private conversation with any other legitimate party — including a shadchan I'm
connected to — so that no conversation is structurally blocked just because the two parties
sit in different contexts (FR94, FR98).

## Position in Epic 7

**4th of 5. Depends on 7.1-7.3.** Precedes 7.5 (notifications must fan out correctly
regardless of which axis a thread uses).

### What this story is, after the AD-20 restructure

**The schema work that used to live here has moved into 7.1.** `public.connections`, the
nullable `connection_id` column on `threads`/`thread_participants`/`messages`, their
`<table>_scope_check` XOR constraints, the second composite unique key
(`threads_connection_id_id_key`), the second composite FK on each child table, the
connection indexes, and the both-axis `purge_polymorphic_dependents()` delete are **all
shipped by 7.1**. An earlier revision had this story run `alter column account_id drop not
null` plus four new constraints and two new FKs per table, over live production rows, on
tables the `make check-migration-safety` fixture did not seed. That is the exact shape of
the two near-misses this repo's guards exist for, and it bought nothing: the columns cost
nothing in the migration that creates the tables. **Deleted, not retargeted.**

What is left is the whole of the *capability*, and it is a real story:

- `create_thread()` gains `p_connection_id` and its validation;
- `thread_is_readable()`'s "connection-scoped → false" line (7.1) becomes the real branch;
- the three INSERT policies gain their connection disjunct;
- the household-side subject resolution (a shadchan's active context holds no `shidduchim`);
- cross-side participant validation;
- the connection-scoped default-posture resolution 7.2 deferred;
- and the four-pairing + negative proof this epic's AC actually names.

**No migration in this story adds, drops, narrows or renames a column.** It is
`CREATE OR REPLACE FUNCTION` plus `CREATE POLICY` replacements. Say so in the migration's
header comment, because that is what makes it safe to apply without a production rehearsal
of a data-bearing change (rehearse it anyway — see Task 5).

### The surface honesty note — read before estimating

This story has **no user-reachable UI**, and that is correct, not a gap:

- `connections` is read-only to `authenticated` (7.1 AC-6). Nothing in Epic 7 lets a user
  propose or accept a connection; that is **Epic 8 Story 8.2**'s invite-based consent flow
  (AD-11/FR119). Rows exist only by `service_role` seed until then.
- There is no Connection 360. The binding contract reserves the row
  **Connection — `overview, discussions`** for **Epic 8** (§3 rule 5), and
  `CANONICAL_TAB_SETS` (`entity360/ad24Conformance.ts:209-242`) has no `connections` entry
  today. **Do not add one here.** Adding a row without a registered descriptor, or a
  descriptor without a row, fails the AD-24 validator in opposite directions — and Epic 8
  Story 8.5 owns that pairing.

So this story is delivered as a **database capability with a proof**, and epics.md's
"shadchan↔single is enabled by default, not gated off" is discharged at the boundary where
"enabled" means anything: the database. Epic 8 makes it reachable. Flag this in the story's
completion notes rather than inventing a surface, and do not let a reviewer read the absent
UI as an unfinished story.

## Acceptance Criteria

1. **`create_thread()` accepts a connection.** A new `p_connection_id bigint default null`
   parameter. When supplied: the caller's active context must be one side of that connection
   with `status = 'accepted'`, or the call raises `42501`; the thread is created with
   `connection_id` set and `account_id` null. Supplying **both** `p_connection_id` and
   relying on the account default is not a thing — the axis is chosen by the parameter's
   presence. **Falsifiable:** a caller whose active context is neither side raises; a caller
   whose connection is `status='ended'` raises.

2. **A connection-scoped shidduch subject resolves against the household side, not the
   caller.** When `p_subject_type='shidduch'` **and** `p_connection_id` is supplied, the
   subject-exists check resolves against the connection's `household_account_id`, **not**
   `current_context_id()` — a shadchan's active context is their *shadchanus* account, which
   by AD-2 may never contain a household domain row and therefore holds no `shidduchim` at
   all. **Falsifiable:** a shadchan creates a connection-scoped thread about a real shidduch
   of the connected household and it succeeds; about a shidduch of a *different* household
   it raises. Under 7.1's account-only check the first of those two would have failed for
   every shadchan caller.

3. **Cross-side participants are legal, and only cross-side.** For a connection-scoped
   thread, an id in `p_participant_member_ids` is accepted if it is an active
   `account_members` row of **either** side of the connection; anything else raises, per
   7.1's fail-fast rule. **Falsifiable:** a member of an unrelated third account raises.

4. **`thread_is_readable()` gains its third branch.** For a connection-scoped thread,
   readability requires the caller's active context to be a member of that connection
   (either side) with `status='accepted'`; if that passes, the **identical** open/private
   resolution as the account branch applies — 7.1's dignity-floor gate for `open`, 7.3's
   participants-only rule for `private` — written once and shared, not duplicated per
   branch. The 7.1 line that returned `false` for any connection-scoped thread is replaced,
   which makes this change a pure widening with nothing previously readable to un-leak.

5. **The dignity floor does not stop applying because a shadchan is in the room.** An *open*
   connection-scoped thread about a `shidduch` is still hidden from a household-side caller
   with `current_member_role() = 'single'` unless the subject satisfies Epic 6's shipped
   three-part test (`visibility='shared'` **and** `is_single_visible_state(pipeline_state)`
   **and** the subject's `single_id` resolves to a `singles` row whose `member_id =
   current_member_id()` — `05_policies.sql:352-367`). AD-22 rule 2 ("open never widens
   AD-3") does not lapse across the connection axis. A `single`-role membership can only
   exist on the household side (the role/kind trigger from Story 2.2), so no shadchanus-side
   case arises. A *private* connection-scoped thread is participants-only, exactly as in 7.3
   — including 7.3 AC-6's boundary: the single reads the thread, and still reads zero rows
   from `shidduchim`/`resumes`/`interactions`/`entity_files` for that subject.

6. **INSERT works on both axes, not just SELECT.** 7.1's `with check` clauses on
   `threads`/`thread_participants`/`messages` all require `account_id =
   current_context_id() and connection_id is null`, which is unconditionally false for a
   connection-scoped row. Each is replaced with a two-disjunct form accepting **either**
   axis, keeping 7.1's participant-membership `exists` clause on `messages` and
   `thread_participants` unchanged. **The falsifying test is a real client-side INSERT, not
   a service-role seed:** the shadchan side of the AC-8 connection posts a message through
   `dataProvider.create("messages", …)` and it succeeds. Without this task, that INSERT is
   rejected while `thread_is_readable()` reports the row as perfectly readable once it
   exists — a half-migrated policy that passes any smoke test where an operator seeds the
   row directly, and breaks on the first real user action.

7. **Connection-scoped threads resolve their default posture from the household.** 7.2's
   `coalesce(p_visibility, (select default_thread_visibility from accounts where id =
   v_account_id))` yields NULL when `v_account_id` is NULL and would violate `visibility`'s
   NOT NULL. Resolve from the connection's **`household_account_id`** — FR99 gives *families*
   the default posture, and the household is the only family in the pair. **Falsifiable:**
   household default `'private'` + `create_thread(p_connection_id => …)` with no
   `p_visibility` yields a `'private'` thread; the shadchanus account's own setting has no
   effect on it either way.

8. **All four pairings are proven, in one place.** parent↔parent, parent↔single,
   parent↔shadchan, single↔shadchan. The first two are account-scoped private threads
   (7.1/7.3 machinery, asserted here so the epic's AC is discharged in one file, reusing
   7.3's fixtures where they already prove it); the last two are connection-scoped, tested
   against a directly seeded `status='accepted'` connection — per 7.1 AC-6 there is no
   client path to create one, and that is deliberate.

9. **Verification — the negative test.** A shadchan whose shadchanus is **not** party to a
   given connection reads zero rows from that connection's `threads`/`messages`/
   `thread_participants`, even though they hold the `shadchan` role generally. A household
   member of a **different** household reads zero rows likewise. A member of the *right*
   household but of a connection whose `status='ended'` also reads zero rows — ending a
   connection ends the reads, which no other assertion here covers. Each denial matched by
   specific SQLSTATE or asserted by row count in the `db` project; **never
   `exception when others then … PASS`**, and each denial proven by mutation with an
   unrelated failure separately proven still failing.

10. **The purge already covers both axes — assert it, do not re-implement it.** 7.1's
    fifth delete inside `purge_polymorphic_dependents()` (`02_functions.sql:2466`) already
    walks `connections.household_account_id` for connection-scoped threads. This story adds
    the assertion that exercises it end to end: a connection-scoped
    `subject_type='shidduch'` thread + message; delete the subject `shidduchim` row; the
    thread, its messages and its participants are gone. If this test fails, fix 7.1's
    function — do not add a second delete here.

11. **Verification — the toolchain is green**, including every prior (7.1-7.3) assertion in
    `threads_entity.sql` still passing unchanged. `make check-migration-safety` passes;
    the fixture already seeds the four Epic 7 tables (7.1 Task 9) and this story adds a
    seeded `connections` row on each axis if the existing seed does not already cover both.

## Tasks / Subtasks

- [x] **Task 1 — A shared connection-membership predicate** (AC: 1, 4, 6)
  - [x] `supabase/schemas/02_functions.sql`:
        `public.connection_is_active_for_caller(p_connection_id bigint) returns boolean` —
        `STABLE SECURITY DEFINER SET search_path ''`, `pg_dump` form. Body:
        `exists (select 1 from public.connections c where c.id = p_connection_id and
        c.status = 'accepted' and (c.household_account_id = public.current_context_id() or
        c.shadchanus_account_id = public.current_context_id()))`.
  - [x] Write it once and call it from `create_thread()`, `thread_is_readable()` and all
        three INSERT policies. Three inline copies of the same `exists` is exactly the drift
        surface 7.1/7.3 avoided by centralizing `thread_is_readable()`; do not reintroduce
        it here. `06_grants.sql`: revoke from `public, anon`, grant execute to
        `authenticated, service_role` (RLS policies evaluate as the querying role, so
        `authenticated` needs it).

- [x] **Task 2 — `thread_is_readable()` v3** (AC: 4, 5, 9)
  - [x] `CREATE OR REPLACE FUNCTION "public"."thread_is_readable"(…)`. Restructure the body
        into two parts, so the open/private decision is written **once**:
        1. **Scope gate.** If `account_id is not null` → require
           `account_id = public.current_context_id()`. Else (`connection_id is not null`) →
           require `public.connection_is_active_for_caller(connection_id)`. This replaces
           7.1's `connection_id is not null → return false` line.
        2. **Visibility resolution**, identical for both axes: `private` → participant-only
           (7.3); `open` → if `subject_type='shidduch'` and
           `current_member_role() = 'single'`, apply Epic 6's three-part test on the subject
           row (AC-5); otherwise true.
  - [x] Do not duplicate step 2 per branch. If the plpgsql shape makes that awkward, extract
        step 2 into a small `public.thread_visibility_permits(p_thread_id bigint) returns
        boolean` with the same definer/`search_path` hardening, and have
        `thread_is_readable()` call it after the scope gate — one authority, two callers, no
        copy.

- [x] **Task 3 — `create_thread()` v3** (AC: 1, 2, 3, 7)
  - [x] `CREATE OR REPLACE FUNCTION public.create_thread(p_subject_type text, p_subject_id
        bigint default null, p_participant_member_ids bigint[] default '{}', p_visibility
        text default null, p_connection_id bigint default null)`. **Appending a defaulted
        parameter changes the function's identity for `db diff` purposes** — hand-check
        whether the generated migration `DROP`s and re-creates it, and whether the old
        4-argument signature survives as a second overload. If it does, drop the old
        signature explicitly in the same migration and re-issue its grants; two overloads
        differing only by a defaulted tail argument make every call ambiguous
        (`42725`).
  - [x] When `p_connection_id` is supplied: require
        `public.connection_is_active_for_caller(p_connection_id)` or raise `42501`; set
        `connection_id := p_connection_id`, `account_id := null`.
  - [x] Subject resolution (AC-2): resolve `v_household_account_id := (select
        household_account_id from public.connections where id = p_connection_id)` and check
        `exists (select 1 from public.shidduchim where id = p_subject_id and account_id =
        v_household_account_id)`. For the account axis, 7.1's `current_context_id()` check
        is unchanged. AD-4 is the reason: "the resulting suggestion is owned by the
        household; only the conversation about it is connection-scoped."
  - [x] Participant validation (AC-3): for a connection-scoped thread, accept an id whose
        `account_members.account_id` is **either** `household_account_id` or
        `shadchanus_account_id` and whose `status = 'active'`; raise otherwise. For the
        account axis, 7.1's rule is unchanged.
  - [x] Default-posture resolution (AC-7): `coalesce(p_visibility, (select
        a.default_thread_visibility from public.accounts a where a.id =
        coalesce(v_account_id, v_household_account_id)))`. One expression, both axes.
  - [x] Every participant row inserted must carry the thread's axis — 7.1's
        `set_thread_participant_defaults()` copies both scope columns from the parent, so
        insert the participant rows with both left NULL and let the trigger do it. Do not
        hand-set `account_id` in the RPC; that is how the two get out of step.

- [x] **Task 4 — The three INSERT policies** (AC: 6)
  - [x] `supabase/schemas/05_policies.sql`. Replace each of 7.1's three `with check`
        clauses with the two-disjunct form:
        - `threads`: `((account_id = public.current_context_id() and connection_id is null)
          or (connection_id is not null and
          public.connection_is_active_for_caller(connection_id)))`.
        - `thread_participants` and `messages`: the same scope disjunction **and** 7.1's
          participant-membership `exists` clause, unchanged — a connection-scoped message
          still requires the caller to be a listed participant of that thread. 7.1 AC-8 is
          not relaxed by this axis.
  - [x] Replacing a policy is `drop policy` + `create policy`; both statements land in the
        same migration and DDL is transactional, so there is no window where the table is
        unprotected. Confirm by reading the generated migration — not by assuming `db diff`
        produced a `create or replace`, which does not exist for policies.
  - [x] Do not touch the SELECT policies. They call `thread_is_readable()` and Task 2
        extends every one of them for free.

- [x] **Task 5 — Generate, hand-check and rehearse the migration** (AC: 1, 2, 4, 6, 7)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        connection_scoped_threads`. Hand-inspect: (a) all function bodies emitted (a
        `plpgsql` body change with an unchanged signature is sometimes missed — write it in
        by hand if absent); (b) the `create_thread` signature situation from Task 3;
        (c) three `drop policy` + three `create policy` pairs; (d) **no** `ALTER TABLE`
        anywhere — if the diff wants to alter a column, something in 7.1 did not land as
        specified and this story must stop and report rather than absorb it.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`, then
        `db diff` twice more to prove convergence. Never `db reset` on a stack holding
        data; never `db push`.
  - [x] `make check-migration-safety`, then rehearse against a **production-shaped,
        non-empty** database. This migration adds no column, but it *replaces the policies
        that decide who can write to three tables* — the rehearsal here is about a policy
        that denies more than intended, which an empty database cannot show you.

- [x] **Task 6 — Types and providers** (AC: 1)
  - [x] `src/components/atomic-crm/types.ts`: add `connection_id?: Identifier | null;` to
        `CreateThreadInput`. `Connection`, and `connection_id` on
        `Thread`/`ThreadParticipant`/`Message`, already land in 7.1 — do not re-declare.
  - [x] `providers/supabase/dataProvider.ts`: extend `createThread()`'s RPC payload with
        `p_connection_id: input.connection_id ?? null`.
  - [x] `providers/fakerest/`: mirror the connection branch of `createThread` and of the
        readability rule (AD-10), and seed a `db.connections` row with `status='accepted'`
        plus a shadchanus account in the demo generator, since there is no in-app way to
        create one. The demo build is the only place a human will see a connection-scoped
        thread before Epic 8.

- [x] **Task 7 — Tests** (AC: 6, 8, 9, 10, 11)
  - [x] Extend `supabase/tests/threads_entity.sql`. Fixture: a household account, a
        shadchanus account, an `accepted` `connections` row seeded as `service_role`, a
        second unconnected shadchanus, a second unrelated household, and an `ended`
        connection.
  - [x] AC-8: a `subject_type='relationship'` **private** connection-scoped thread with the
        household's single and the shadchan as participants — both sides read it and its
        message (single↔shadchan); the same for parent↔shadchan; plus the account-scoped
        half (parent↔parent, parent↔single) reusing 7.3's fixtures.
  - [x] AC-6: the shadchan side posts a message through a real **client** INSERT (an
        `authenticated` session, not `service_role`) and it succeeds. This is the assertion
        that would silently pass without Task 4 and then break on first use.
  - [x] AC-2: a shadchan creates a connection-scoped thread on the household's shidduch
        (succeeds) and on another household's (raises).
  - [x] AC-5: an open connection-scoped thread about a shidduch that fails any one of Epic
        6's three clauses reads zero rows for the household's `single` — one assertion per
        clause, so a gate that checks only `is_single_visible_state()` cannot pass.
  - [x] AC-7: household default `'private'`, connection-scoped `create_thread()` with no
        `p_visibility` → `'private'`; flipping the *shadchanus* account's setting changes
        nothing.
  - [x] AC-9's three negatives and AC-10's purge assertion.
  - [x] Prove the suite can fail: revert Task 4's `messages` policy to 7.1's form and
        confirm AC-6 goes red; revert Task 2's scope gate to `return true` and confirm
        AC-9 goes red. Then ship them green.
  - [x] Re-run the full suite for AC-11 (no 7.1-7.3 regressions).
  - [x] Vitest for the FakeRest connection branch (AAA, ≥80% of new lines). **No new
        browser-mode component test** — this story adds no component.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus prettier
        on this story's changed files only.

## Dev Notes

### Why `connections` has no client write path (and why that is this story's problem too)

A plain `for all` RLS policy on `connections` — the pattern most domain tables use — would
let any authenticated household member call `dataProvider.create("connections", {
household_account_id: mine, shadchanus_account_id: anyone's, status: "accepted" })` and
self-grant a connection to **any** shadchan without their consent: a direct violation of
FR109 ("no directory-driven or automatic linkage") and of AD-20, in the very story meant to
prove pairings are *permitted* rather than that consent is *bypassable*. 7.1 ships the
`subscription`/`ai_usage` posture instead (read-only to `authenticated`, every write
`service_role` — `05_policies.sql:1048-1063`, `06_grants.sql:847-858`). This story inherits
that and must not loosen it to make its own tests easier: seed connections as `service_role`.

**Epic 8 Story 8.2 `ALTER`s this table; it does not re-create it.** 7.1's `status`
vocabulary (`accepted | ended`, no `pending` — AD-20 says a connection exists only after
acceptance, and the proposal state lives in the invite mechanism per AD-11/FR119) and the
partial live-pair unique index were chosen so 8.2's extension (`proposed_by_account_id`,
`ended_by_account_id`, the propose/accept/end RPCs) is purely additive.

### The household-side subject check

A shadchan's active context is always their **shadchanus** account (AD-2: "a shadchanus
context may never contain household domain rows", enforced by `enforce_household_scope()`).
So `current_context_id()` cannot validate a `shidduch` subject for a shadchan caller — it
resolves to an account that holds no `shidduchim` rows at all, and every such call would
raise. The check must walk `connections.household_account_id` to find the household side and
verify the row belongs to it. This mirrors AD-4: "the resulting suggestion is owned by the
household; only the conversation about it is connection-scoped."

Note what this does *not* do: it does not let a shadchan read the shidduch row. `shidduchim`
RLS is `account_id = current_context_id()` and is untouched by Epic 7. A shadchan sees the
conversation about a shidduch, and the thread's `subject_id`; the shidduch itself stays in
the household. That is FR113 being structural rather than policed.

### Why the `ended` case is called out separately

`connection_is_active_for_caller()` requires `status = 'accepted'`, so ending a connection
ends every read on its threads — including threads whose participants are unchanged. That is
the intended reading of AD-20's "either side may end it", but it is the kind of behaviour
that is only obviously correct once someone has asserted it (AC-9). The messages are not
deleted; they become unreadable, and a future story that wants an export-on-end has a clean
place to hang it.

### What moved to 7.1, so nobody rebuilds it

`connections` (table, kind trigger, SELECT policy, grants, partial unique index);
`connection_id` on all three thread tables; the XOR `<table>_scope_check` constraints;
`threads_connection_id_id_key`; the second composite FK per child table; the connection
indexes; the scope-copying trigger functions; the both-axis delete inside
`purge_polymorphic_dependents()`. If any of these is missing when this story is picked up,
**stop and report** — do not add it here, because adding it here reintroduces exactly the
production-narrowing migration this restructure removed.

### References

- [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-20`]
  — the connection as a third scope; "a shadchan therefore cannot address a household row at
  all — FR113 is structural."
- [Source: same file `#AD-1`] — exactly one scoping axis per row.
- [Source: same file `#AD-2`] — "a shadchanus context may never contain household domain
  rows."
- [Source: same file `#AD-4`] — a shidduch redted through a connection still belongs to the
  household.
- [Source: same file `#AD-22`] — resolution rules 1-3.
- [Source: `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/decisions-log.md#D17`]
  — groups "Shadchan context + connections + messaging" as one delivery slice, the root of
  the cross-epic ordering tension 7.1 resolves by creating the bare table.
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic-8-Shadchan-Context`] — Story 8.2
  owns the propose/accept RPCs, on top of 7.1's table.
- [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §3 rule 5] — the
  **Connection** tab row (`overview, discussions`) is **Epic 8's** to add to
  `CANONICAL_TAB_SETS`, together with its descriptor. Not this story's.
- `supabase/schemas/02_functions.sql:249`/`:290`/`:316` (context/member/role resolvers),
  `:1484` (`is_single_visible_state`), `:2466` (`purge_polymorphic_dependents`).
- `supabase/schemas/05_policies.sql:352-367` (Epic 6's three-part single gate, applied
  unchanged across the connection axis by AC-5), `:1048-1063` (`subscription`/`ai_usage`
  read-only precedent).
- `supabase/schemas/06_grants.sql:290-292` (function-grant convention), `:847-858`
  (read-only-to-`authenticated` table + sequence pattern).
- `src/components/atomic-crm/entity360/ad24Conformance.ts:209-242` (`CANONICAL_TAB_SETS` —
  no `connections` row today, and this story adds none).
- Story `7-1-thread-model.md` — every table, column, constraint and FK this story consumes.

## Dependencies

- **7.1** (blocking, structural): `connections`, `connection_id`, both composite FK sets,
  the XOR checks, the scope-copying triggers, the both-axis purge delete.
- **7.2** (blocking): the `default_thread_visibility` column AC-7 reads.
- **7.3** (blocking): the private branch AC-4's shared resolution reuses.
- **Blocks 7.5**, whose fan-out must copy the right scope column onto every notification.
- **Epic 8 Story 8.2** must `ALTER` `connections`, never re-create it. **Epic 8 Story 8.5**
  owns the Connection 360 and the `CANONICAL_TAB_SETS.connections` row.
- **Wave:** writes `02_functions.sql`, `05_policies.sql`, `06_grants.sql`, `types.ts`, both
  dataProviders and `threads_entity.sql` — **never the same wave as 7.1, 7.2, 7.3 or 7.5**.

## Declared file set

**Schema / DB**
`supabase/schemas/02_functions.sql`, `05_policies.sql`, `06_grants.sql`, one new
`supabase/migrations/<ts>_connection_scoped_threads.sql`,
`supabase/tests/threads_entity.sql` (extended),
`supabase/tests/migration-data-safety/fixture.sql` (only if 7.1's seed does not already
cover both axes).

**Types / providers**
`src/components/atomic-crm/types.ts`,
`providers/supabase/dataProvider.ts`,
`providers/fakerest/dataProvider.ts`,
`providers/fakerest/dataGenerator/**` (the seeded shadchanus account + connection).

**Generated**
`registry.json` (pre-commit `make registry-gen`) — only if a source file under `src/` moves
or is added.

No `01_tables.sql` change, no column-order risk, no i18n change, no descriptor change, no
`CANONICAL_TAB_SETS` change, no new component, no route change.

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), dispatched as the developer for STACK_ID=4 / STACK_OWNER=7-4.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir .supabase-e2e-4 --local -f connection_scoped_threads` — confirmed the generated diff auto-drops the old 4-arg `create_thread` overload (the exact 42725 trap Task 3 named), emits all four function bodies and both policy replacements, and contains **no** `ALTER TABLE`.
- `db diff` re-run twice after `migration up` — both `"No schema changes found"`.
- `make check-migration-safety STACK_ID=4` — PASSED (3 runs across the session, last one: 51 seeded rows / 22 tables survived intact).
- Falsification proof (Task 7's own requirement, done by hand against the live stack 4 DB, then restored and re-verified clean via `db diff`):
  - Reverted the `messages` INSERT policy to 7.1's single-axis form → the AC-6 client-INSERT assertion aborts the whole suite (real RLS denial, not a graceful `false`) — confirms the suite is not vacuous for AC-6.
  - Reverted `thread_is_readable()`'s scope gate to skip straight to `thread_visibility_permits()` → 6 assertions go red (the 3 AC-9 negatives, the two set_thread_visibility ended-connection checks, and — as a bonus regression signal — the pre-existing AC-11 tenant-isolation checks, since the scope gate is what AC-11 also depends on).
  - Restored both, re-ran `db diff` twice (clean) and the full db suite (98/98 threads_entity checks, 966/966 db suite) to confirm the fix, not just the break.
- `npx vitest run` / `make test STACK_ID=4`: 228 files / 2639 tests green (STACK_ID=4 exported so DB suites target this story's own stack, never the shared dev stack on port 54322 that other agents in this session may be using).

### Completion Notes List

- All 11 ACs implemented and proven in `supabase/tests/threads_entity.sql` (98 named checks, up from 85 before this story; two Story 7.3 assertions about the connection axis being permanently closed were rewritten in place to their correct post-widening behavior — see "Deviations" below).
- **AC-10 needed no new code or test**: 7.1's `purge_polymorphic_dependents()` already walks `connections.household_account_id` for a connection-scoped thread, and 7.1's own AC-10 block (`threads_entity.sql:492-556`, unchanged) already seeds and proves a connection-scoped `subject_type='shidduch'` thread + message deleted end-to-end when the subject `shidduchim` row is deleted. Re-verified it still passes; did not duplicate it.
- **No user-facing surface was added**, by design — the story's own "surface honesty note." `CreateThreadInput.connection_id` and the `create_thread()` RPC's `p_connection_id` are real, callable capabilities; no component in `src/components/atomic-crm/threads/**` was touched, and none needed to be. A future Epic 8 story wires a UI to it.
- **Deviations from the story's literal Task 4 wording, both examined and intentional:**
  1. The story's AC-6/Task 4 text refers to "7.1's **three** INSERT policies" (`threads`/`thread_participants`/`messages`). The shipped tree (post-7.1-review-fix, F2/F4) has only **two** — `threads` has no INSERT policy or grant at all for `authenticated`; `create_thread()` (SECURITY DEFINER) is its sole writer, and Task 3 already handles the connection axis inside that function. Confirmed via `06_grants.sql` (no INSERT grant on `threads`) and `05_policies.sql`'s own comment. Only `thread_participants` and `messages` needed the two-disjunct widening. This matches AC-6's actual falsifiable test (a `messages` INSERT), so nothing is under-covered.
  2. `thread_participants`' direct-INSERT policy carries a SECOND `exists()` clause (the 7.1 "F3" review fix) validating that an ADDED participant belongs to the caller's OWN account. Per the story's explicit "unchanged" instruction for this clause, it was left as `account_id = current_context_id()` — meaning a cross-side addition through this specific defense-in-depth path (not `create_thread()`, which does correctly admit either side per AC-3) stays denied. No built UI reaches this path today, and no AC in this story tests it on the connection axis. Documented in `05_policies.sql`'s own comment as a scoped, deliberate gap for a future story to widen if a direct "add a participant" UI is ever built.
- **Two Story 7.3 assertions were rewritten, not just extended**, because Story 7.4 is a real behavior change to code those assertions exercised: `threads_entity.sql`'s former "AC-8: the connection axis stays closed until 7.4" test (`set_thread_visibility()` on a service-role-seeded connection thread) now correctly SUCCEEDS for a real participant of an *accepted* connection — this is the "pure widening, nothing to un-leak" AC-4 describes, made concrete. Both the positive (accepted) and a new negative (the identical call once the connection is `ended`, added in Story 7.4's own section) are asserted; the suite would have gone red on this file's very first `make test:unit:db` run if left unchanged, which is the correct signal that the widening happened, not a regression.
- Touched `src/components/atomic-crm/providers/fakerest/internal/threads.ts`, `.../dataGenerator/index.ts`, and added `src/components/atomic-crm/providers/fakerest/dataProvider.threadsConnectionAxis.test.ts` — none of these three paths are named literally in this story's own "Declared file set" (which lists only `providers/fakerest/dataProvider.ts` and `providers/fakerest/dataGenerator/**`). `internal/threads.ts` is where `createThread()`/`createMessage()`/`createThreadParticipant()`/`setThreadVisibility()` have lived since Story 7.1 (itself declared the same narrow way); `dataGenerator/index.ts` needed one comment fix once `dataGenerator/shidduchim.ts` started seeding `db.connections`; the new test file is the direct implementation of Task 7's explicit "Vitest for the FakeRest connection branch" instruction, which only exists in that module. Treated as within the intent of the declared `providers/fakerest/**` entries rather than stopping to ask, since the alternative (task 6/7 literally undoable) was worse than a narrow, explainable overage with no cross-agent collision risk (solo dispatch, not a parallel wave).
- `src/components/atomic-crm/providers/fakerest/internal/threads.ts` grew from 347 to 480 lines (past the coding-style rule's ~400-line "typical" ceiling, well under its 800 hard max). Chose not to extract a further module for two new ~15-line predicate helpers plus the widened `createThread()` body, to avoid growing the "touched but undeclared" file surface noted above.
- `make check-migration-safety`'s fixture (`supabase/tests/migration-data-safety/fixture.sql`) needed **no** change — 7.1's own seed already carries one thread on each scope axis over the same subject, discharging this story's "extend the fixture if it does not already cover both axes" instruction as a no-op.

### File List

**Schema / DB**
- `supabase/schemas/02_functions.sql` — modified (new `connection_is_active_for_caller()`, new `thread_visibility_permits()`, `thread_is_readable()` v3, `create_thread()` v3, updated stale comments on `set_thread_visibility()`)
- `supabase/schemas/05_policies.sql` — modified (two INSERT policies widened to a two-disjunct scope check)
- `supabase/schemas/06_grants.sql` — modified (grants for the two new functions; `create_thread()`'s grant re-issued under its new 5-arg signature)
- `supabase/migrations/20260802035346_connection_scoped_threads.sql` — new
- `supabase/tests/threads_entity.sql` — modified (rewrote two stale Story 7.3 assertions; appended a full Story 7.4 section: 8 new fixture rows, AC-1/2/3/5/6/7/8/9 assertions, 98 named checks total)
- `supabase/tests/migration-data-safety/fixture.sql` — unchanged (already covers both axes; verified, not edited)

**Types / providers**
- `src/components/atomic-crm/types.ts` — modified (`CreateThreadInput.connection_id`; updated stale `Thread` doc comment)
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — modified (`createThreadViaRpc` forwards `p_connection_id`)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — modified (`createThread` wrapper resolves the default-visibility source account from the connection's household side)
- `src/components/atomic-crm/providers/fakerest/internal/threads.ts` — modified (connection-axis support in `createThread`, plus a shared `isConnectionActiveForAccount`/`isThreadInCallersScope` used by `createMessage`/`createThreadParticipant`/`setThreadVisibility`) — see Completion Notes re: declared-file-set overage
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts` — modified (seeded shadchanus account + accepted connection)
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts` — modified (comment fix only, reflecting the new seed)
- `src/components/atomic-crm/providers/fakerest/dataProvider.threadsConnectionAxis.test.ts` — new (Vitest, AAA, connection-axis coverage for `createThread`/messages/thread_participants/`setThreadVisibility`)

**Generated**
- `registry.json` — verified unchanged (`make registry-gen` run; no diff, as expected — no shadcn component added or moved)

## Change Log

- 2026-08-02: Story 7.4 implemented — the connection axis opened. `connection_is_active_for_caller()` (new, shared authority); `thread_is_readable()` restructured into a scope gate + shared `thread_visibility_permits()`; `create_thread()` gained `p_connection_id` with household-side subject resolution, cross-side participant validation and household-side default-posture resolution (the old 4-arg signature dropped in the same migration to avoid a `42725` overload ambiguity); the `thread_participants`/`messages` INSERT policies widened to a two-disjunct scope check; `threads_entity.sql` extended with the four-pairing proof and the three AC-9 negatives (98 checks total, up from 85), including two Story 7.3 assertions rewritten to their correct post-widening behavior; FakeRest mirrors added for AD-10 parity plus a new Vitest file. All gates green: `make typecheck`, `make lint`, `npx vitest run` (228 files / 2639 tests, STACK_ID=4), `make build`, `npx prettier --check .` (no new issues), all four CI guards, `make test STACK_ID=4`, `supabase db diff --local` clean twice, `make check-migration-safety STACK_ID=4` PASSED.
