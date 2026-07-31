# Story 7.1: Thread model

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want threads modelled as subject-scoped, structured records — never free-form chat —
so that permission and history are tractable for every persona pair (FR94, FR95).

## Position in Epic 7

**1st of 5.** This story lays the schema every other Epic 7 story extends:

7.1 (this story) → 7.2 (default posture) → 7.3 (private enforcement) → 7.4 (connection
capability) → 7.5 (notifications)

- **7.2** adds `accounts.default_thread_visibility` and teaches `create_thread()` to read
  it on **both** scope axes.
- **7.3** adds the participant-only branch to `thread_is_readable()` and a
  `set_thread_visibility()` RPC — this story's RLS deliberately does **not** yet
  distinguish `open` from `private` (see Dev Notes "What this story does not do").
- **7.4** makes the connection axis *reachable*: `create_thread(p_connection_id …)`,
  `thread_is_readable()`'s connection branch, the connection branch of the three INSERT
  policies, and the four-pairing proof. **It alters no column and adds no constraint** —
  see "AD-20: the dual axis is born here, not retrofitted" below.
- **7.5** adds `thread_participants.last_read_at`, `message_notifications`, and delivery.

### AD-20: the dual axis is born here, not retrofitted — a flagged decision

AD-20 ("a connection is a third scope, owned by neither party") and AD-1 ("every domain
row is scoped by **exactly one** of two axes — a non-null `account_id` **or** a non-null
`connection_id`") together mean a thread table must be able to express both axes from the
moment it exists. AD-22 resolution rule 3 says the same thing for threads specifically.

An earlier revision of this epic had this story ship `threads.account_id NOT NULL` with no
`connection_id`, and had **Story 7.4** run `alter column account_id drop not null`, add
`connection_id`, add an XOR check, add a second composite unique key and a second composite
FK to each of three tables, and rewrite three INSERT policies and three trigger functions.
That is a narrowing/reshaping migration over live production rows, on tables the
`make check-migration-safety` fixture does not seed — the exact shape of the two near-misses
this repo's guards exist for. **Deleted.** The columns, constraints, keys and FKs all land
here, in the migration that creates the tables, where they cost nothing.

**Consequence, stated plainly:** this story creates `public.connections` — a bare,
**read-only-to-`authenticated`** table with its kind-enforcement trigger and its SELECT
policy, and nothing else. `connection_id` cannot carry a foreign key to a table that does
not exist, and AD-1 requires a table's RLS to land in the same migration as the table.
`epics.md` places the *consent workflow* (propose/accept/end, per AD-11/FR119) in **Epic 8
Story 8.2**; 8.2 `ALTER`s and extends what this story ships and **must not re-create the
table, its trigger or its policy**. This is a deliberate cross-epic decision, repeated in
the final report, not scope quietly annexed from Epic 8.

### Already in the tree (verified against `main` @ `11904a1`, 76 migrations)

Everything this story builds on is present today. No forward references remain.

- `public.current_context_id()` — `supabase/schemas/02_functions.sql:249`. The one context
  resolver (`STABLE SECURITY DEFINER SET search_path ''`, fails closed, AD-19).
  `current_account_id()` no longer exists anywhere.
- `public.current_member_id()` — `02_functions.sql:290`. Resolves the caller's own
  `account_members.id` in the active context. **Never re-resolve a member inline.**
- `public.current_member_role()` — `02_functions.sql:316`. Returns the caller's
  `account_members.role` in the active context.
- `public.is_single_visible_state(public.pipeline_state)` — `02_functions.sql:1484`. Note
  the parameter type: it takes the **enum**, not `text`. Grants at `06_grants.sql:290-292`.
- `accounts.kind` ∈ `household | shadchanus` — `01_tables.sql:188-189`, at the **tail** of
  the table (column-order trap).
- `account_members.role` admits all five `MemberRole` values including `'single'`
  (`types.ts:137-138` is the one TS union).
- `public.purge_polymorphic_dependents()` — `02_functions.sql:2466-2488`. Four deletes
  today (`identity_signals`, `interactions`, `tasks`, `entity_files`), wired at
  `04_triggers.sql` for `references` and `shidduchim`.
- The Entity360 framework, the closed `TabKey` union (which **already contains
  `discussions`**), `CANONICAL_TAB_SETS`, `visibleTo`/`useViewerRole`/`hasVisibility`, and
  the AD-24 conformance validator are all shipped. See Task 8.
- **No table in this repo has `FORCE ROW LEVEL SECURITY`** — `01_tables.sql:142` and
  `05_policies.sql:1090` both say so in comments. See AC-7.

## Acceptance Criteria

1. **A thread is a real table, not a free-text field.** `public.threads` exists with
   `subject_type` ∈ `('shidduch', 'relationship')` and `subject_id` — non-null and
   pointing at a `shidduchim` row reachable from the thread's own scope when
   `subject_type='shidduch'`; null when `subject_type='relationship'` (a general
   conversation not tied to one shidduch). No other subject type exists yet (AD-22, FR95).

2. **A thread carries explicit participants.** `public.thread_participants` records which
   `account_members` rows are in the conversation. Every thread has at least one
   participant row (its creator) from the moment it is created; nothing reads "everyone in
   the scope" implicitly.

3. **Visibility is a property of the thread, not derived at read time.**
   `public.threads.visibility` ∈ `('open', 'private')`, defaulting to `'open'`
   (`'private'` is fully modelled by this story's schema; its *enforcement* is 7.3's job —
   see Dev Notes).

4. **Messages are structured rows scoped to a thread**, not appended to the generic
   `interactions` timeline. `public.messages(thread_id, sender_member_id, body,
   created_at)` exists; a message is never editable or deletable through the dataProvider
   (no UPDATE/DELETE RLS policy and no UPDATE/DELETE grant for `authenticated`).

5. **Every thread row declares exactly one scoping axis, from the first migration.**
   `threads`, `thread_participants` and `messages` each carry a nullable `account_id` and a
   nullable `connection_id` with a check constraint asserting exactly one is non-null
   (AD-1, AD-22 rule 3). `public.connections(household_account_id, shadchanus_account_id,
   status)` exists as the FK target, with `status ∈ ('accepted','ended')` — **no
   `'pending'`**, because AD-20 says a connection exists only after acceptance.
   **Falsifiable:** an INSERT with both columns set raises `23514`; an INSERT with neither
   set raises `23514`. Assert both, by SQLSTATE, not by `exception when others`.

6. **`connections` has no client write path.** RLS is enabled with **one** policy — SELECT,
   for a member of either side — and no INSERT/UPDATE/DELETE policy for `authenticated`;
   `06_grants.sql` grants `select` only, and grants the sequence to `service_role` only.
   **Falsifiable:** an authenticated client's `dataProvider.create("connections", …)` for
   a shadchanus it is not connected to inserts zero rows. Without this, the story that is
   supposed to prove pairings are *permitted* would ship a way to make consent
   *bypassable* (FR109: "no directory-driven or automatic linkage").

7. **One creation path.** `public.create_thread(p_subject_type, p_subject_id,
   p_participant_member_ids, p_visibility default null)` is the sole way a thread and its
   initial participants are inserted together; the SPA never calls
   `dataProvider.create("threads", …)` directly (mirrors AD-4's `create_shidduch()`
   precedent, `02_functions.sql:1666`). It validates `p_subject_type`, validates a
   `shidduch` subject exists in the caller's own active account, and always includes the
   caller as a participant. **This story's signature has no `p_connection_id`** — the
   parameter and its validation are 7.4's; until then every thread this function creates is
   account-scoped, and a connection-scoped row can only be seeded by `service_role`.

8. **Posting and participant changes are participant-gated.** Only a listed
   `thread_participants` row for the caller's own membership allows an INSERT into
   `messages` for that thread — regardless of the thread's `visibility` (open threads are
   *readable* more broadly per AD-3/AD-22 rule 2, but *posting* is always participant-only;
   see Dev Notes "Why posting is participant-gated even on open threads"). Likewise, only
   an existing participant may INSERT a new `thread_participants` row for that thread — a
   same-account member can never add *themselves* to a conversation they are not in.
   Without this, 7.3's privacy would be decorative: any member could self-join a private
   thread and then read it.

9. **The single's dignity floor composes with what Epic 6 shipped — it is not re-derived.**
   For a caller with `current_member_role() = 'single'`, a `subject_type='shidduch'` thread
   is readable only when the subject `shidduchim` row is one the caller can already read
   under Story 6.2's shipped policy — **all three clauses**, not just the pipeline state:
   `visibility = 'shared'`, `is_single_visible_state(pipeline_state)`, **and** the row's
   `single_id` resolves to a `public.singles` row whose `member_id = current_member_id()`
   (`05_policies.sql:352-367`). **Falsifiable, and this is the assertion an earlier
   revision of this story would have failed:** a single who is a participant of an *open*
   thread on a **sibling's** shidduch, or on their own shidduch with
   `visibility='private_parent'`, reads **zero** rows — even though the pipeline state is
   single-visible. A gate that checks only `is_single_visible_state()` passes a test suite
   with one single per account and leaks in every household with two.

10. **A deleted shidduch takes its threads with it.** Deleting a `shidduchim` row deletes
    its `subject_type='shidduch'` threads (and, via `ON DELETE CASCADE`, their participants
    and messages) through the **existing** `purge_polymorphic_dependents()` trigger
    function (`02_functions.sql:2466`) — not a new one. The delete covers **both** axes: a
    connection-scoped thread about that shidduch is deleted too (its `account_id` is NULL,
    so an `account_id = old.account_id` predicate alone would miss it and leave a shadchan
    holding a conversation about a deleted shidduch, pointing at a dangling subject).

11. **Tenant isolation holds from the first migration.** A member of account A gets zero
    rows from account B's threads, participants or messages. Negative-test shape is **one
    login with memberships in accounts A and B, active in A** — never two disjoint users,
    which passes without ever exercising `current_context_id()` (contract §13 rule 3).

12. **Verification — the toolchain is green and the migration is rehearsed.**
    `make typecheck`, `npm run lint`, `make test` pass repo-wide with zero new warnings.
    `npm run test:unit:db` (needs `make start`) passes, including
    `supabase/tests/threads_entity.sql`. `make check-migration-safety` passes **with the
    fixture extended** to seed `threads`, `thread_participants`, `messages` and
    `connections` (see Task 9) — the guard is structurally blind to a table it does not
    capture, which is exactly how it was blind to `invites`.

## Tasks / Subtasks

- [ ] **Task 0 — Read before writing a single line of SQL**
  - [ ] `supabase/schemas/01_tables.sql:1-60` — the COLUMN-ORDER TRAP. New tables are
        immune (nothing has been added or dropped yet), but the `create table` block you
        write is the order `db diff` will produce, and `supabase/tests/column_order.test.ts`
        checks every table in the file.
  - [ ] `.claude/rules/security-triggers.md` — this story is RLS, migrations and
        authorization. A negative test is mandatory and is AC-11.
  - [ ] Every `npx supabase` call is prefixed `DBUS_SESSION_BUS_ADDRESS=/dev/null`.

- [ ] **Task 1 — `public.connections`, the bare scope table** (AC: 5, 6)
  - [ ] `01_tables.sql`: `public.connections(id bigint generated by default as identity
        primary key, created_at timestamptz not null default now(), household_account_id
        bigint not null, shadchanus_account_id bigint not null, status text not null default
        'accepted', ended_at timestamptz)`, with `connections_status_check check (status in
        ('accepted','ended'))`.
  - [ ] A **partial** unique index, not a plain unique constraint:
        `create unique index connections_live_pair_idx on public.connections
        (household_account_id, shadchanus_account_id) where status = 'accepted';` — at most
        one *live* connection per pair, while an ended one stays as history and does not
        structurally forbid reconnecting, which AD-20's "either side may end it" would make
        senseless.
  - [ ] FKs in the `alter table` block at the foot of the file (grep for
        `shidduchim_account_id_id_key`, ~`:839`, rather than citing a line — Epic 8 will be
        editing this file): both account columns → `public.accounts(id) on delete cascade`.
        Indexes `connections_household_account_id_idx`, `connections_shadchanus_account_id_idx`
        in the index block (`:1031-1082`).
  - [ ] `02_functions.sql`: `enforce_connection_kinds()` (`before insert or update on
        connections`) — raises unless the household side's `accounts.kind = 'household'` and
        the shadchanus side's `= 'shadchanus'`. Wire it in `04_triggers.sql`. Name it so it
        sorts **after** every `set_*` trigger on the same table/event, per the warning at
        `04_triggers.sql` about alphabetical BEFORE-trigger order.
  - [ ] `05_policies.sql`: enable RLS; **one** policy, SELECT only:
        `using (household_account_id = public.current_context_id() or
        shadchanus_account_id = public.current_context_id())`. No `for insert`/`for update`/
        `for delete` policy (AC-6).
  - [ ] `06_grants.sql`: mirror the `subscription` block at `:847-849,857-858` exactly —
        `revoke all on table public.connections from anon, authenticated;` `grant select …
        to authenticated;` `grant all … to service_role;` and
        `revoke all on sequence public.connections_id_seq from anon, authenticated;`
        `grant all on sequence public.connections_id_seq to service_role;` (no
        `authenticated` sequence grant — `authenticated` cannot insert at all).

- [ ] **Task 2 — The three thread tables, dual-axis from day one** (AC: 1, 2, 3, 4, 5)
  - [ ] `01_tables.sql`: `public.threads(id, account_id bigint, connection_id bigint,
        created_at, subject_type text not null, subject_id bigint, visibility text not null
        default 'open', created_by_member_id bigint)` with
        `threads_subject_type_check check (subject_type in ('shidduch','relationship'))`,
        `threads_subject_id_check` (the paired-null rule in AC-1),
        `threads_visibility_check check (visibility in ('open','private'))`, and
        `threads_scope_check check ((account_id is not null) <> (connection_id is not
        null))` — the XOR, written as `<>` on two booleans so it cannot be satisfied by
        both or neither.
  - [ ] `public.thread_participants(id, account_id bigint, connection_id bigint, thread_id
        bigint not null, member_id bigint not null, created_at)` and
        `public.messages(id, account_id bigint, connection_id bigint, thread_id bigint not
        null, sender_member_id bigint, body text not null, created_at)`, each with its own
        `<table>_scope_check` XOR, and `messages_body_not_blank_check check (btrim(body)
        <> '')`.
  - [ ] Composite-FK plumbing in the `alter table` block, following the `(account_id, id)`
        pattern at `01_tables.sql:835-844` — **two** composite unique keys on `threads`:
        `threads_account_id_id_key unique (account_id, id)` and
        `threads_connection_id_id_key unique (connection_id, id)`. Plus
        `threads_account_id_fkey` → `accounts(id) on delete cascade`,
        `threads_connection_id_fkey` → `connections(id) on delete cascade`,
        `threads_created_by_member_id_fkey` → `account_members(id) on delete set null`
        (nullable, matching `shidduchim.owner_member_id`/`interactions.actor_member_id`).
  - [ ] `thread_participants` and `messages` each get **both** composite FKs to `threads`:
        `(account_id, thread_id) → threads(account_id, id) on delete cascade` and
        `(connection_id, thread_id) → threads(connection_id, id) on delete cascade`.
        Postgres's default `MATCH SIMPLE` skips a multi-column FK check when **any**
        referencing column is NULL, so exactly one of the two does real work per row. **This
        is the first dual-axis child pair in the schema — there is no existing FK pair to
        copy. Verify it by hand with two throwaway INSERTs (one per axis) plus two that must
        fail (a thread_id from the other axis) before relying on it in tests.**
  - [ ] `thread_participants`: FK `member_id` → `account_members(id) on delete cascade` (a
        join row has no meaning without its member — cascade, not set null); unique
        `(thread_id, member_id)`. `messages`: FK `sender_member_id` → `account_members(id)
        on delete set null`.
  - [ ] Indexes in the index block: `threads_account_id_idx`, `threads_connection_id_idx`,
        `threads_subject_idx (subject_type, subject_id)`,
        `thread_participants_account_id_idx`, `thread_participants_connection_id_idx`,
        `thread_participants_member_id_idx`, `messages_account_id_idx`,
        `messages_connection_id_idx`, `messages_thread_id_idx (thread_id, created_at)`.

- [ ] **Task 3 — Triggers: server-set scope, never client-trusted** (AC: 5, 7, 8)
  - [ ] `02_functions.sql`: `set_thread_defaults()` (`before insert on threads`) — when
        **both** scope columns are null, set `account_id := public.current_context_id()`;
        never overwrite a non-null value, and never set both. Set
        `created_by_member_id := public.current_member_id()` when null. Reuse
        `current_member_id()` — do **not** re-resolve the member with an inline
        `account_members` query (the older inline pattern predates it and is not the
        template).
  - [ ] `set_thread_participant_defaults()` and `set_message_defaults()` (`before insert`)
        — each copies **both** `account_id` and `connection_id` from the parent `threads`
        row (`select account_id, connection_id from public.threads where id =
        new.thread_id`) when its own are null, so the child always lands on the same axis as
        its parent. Copying only `account_id` is the bug that makes every connection-scoped
        child row violate its own XOR check. `set_message_defaults()` additionally sets
        `sender_member_id := public.current_member_id()` when null. Never trust a
        client-sent scope column.
  - [ ] `04_triggers.sql`: wire all three as `before insert`, next to the other
        `set_*_account_id` triggers, with names that sort before any `validate_*`/
        `enforce_*` trigger on the same table.
  - [ ] Extend the **existing** `purge_polymorphic_dependents()` (`02_functions.sql:2466`)
        with a fifth delete covering both axes (AC-10):
        ```sql
        delete from public.threads t
        where t.subject_type = v_target_type
          and t.subject_id = old.id
          and (
            t.account_id = old.account_id
            or exists (
              select 1 from public.connections c
              where c.id = t.connection_id
                and c.household_account_id = old.account_id
            )
          );
        ```
        Do **not** write a new trigger — this function is already attached for `references`
        and `shidduchim` in `04_triggers.sql`; the `'reference'` invocation is a no-op
        delete since no thread ever has `subject_type='reference'`.

- [ ] **Task 4 — `thread_is_readable()` and `create_thread()`** (AC: 1, 7, 9)
  - [ ] `public.thread_is_readable(p_thread_id bigint) returns boolean` —
        `STABLE SECURITY DEFINER SET search_path ''`, in exact `pg_dump` form
        (`CREATE OR REPLACE FUNCTION "public"."thread_is_readable"(…)`, contract §8 rule 6,
        or `db diff` produces a phantom diff). This is the **one authority** every Epic 7
        policy calls, exactly as `is_single_visible_state()` is the one authority for its
        axis. v1 body:
        1. Load the thread. If it does not exist, return false.
        2. If `connection_id is not null` → **return false**. The connection axis is
           unreachable to `authenticated` until 7.4 opens it; failing closed here means 7.4
           is a pure widening with nothing to un-leak.
        3. If `account_id <> public.current_context_id()` → false.
        4. If `subject_type = 'shidduch'` **and** `public.current_member_role() = 'single'`
           → return true only when the subject row satisfies Story 6.2's shipped three-part
           test **verbatim in shape** (AC-9): `s.visibility = 'shared'` **and**
           `public.is_single_visible_state(s.pipeline_state)` **and** an
           `exists` on `public.singles c where c.id = s.single_id and c.member_id =
           public.current_member_id()`. Copy the *shape* from
           `05_policies.sql:352-367`, not the literal policy text.
        5. Otherwise true. **Do not branch on `visibility`** — that is 7.3's, and doing it
           here means it gets done twice or reviewed once.
  - [ ] `public.create_thread(p_subject_type text, p_subject_id bigint default null,
        p_participant_member_ids bigint[] default '{}', p_visibility text default null)
        returns public.threads` — `SECURITY DEFINER SET search_path ''`, `pg_dump` form.
        Validates `p_subject_type in ('shidduch','relationship')`; for `'shidduch'`,
        `exists (select 1 from public.shidduchim where id = p_subject_id and account_id =
        public.current_context_id())` or raise; inserts the thread with
        `account_id := public.current_context_id()`, `connection_id := null`,
        `visibility := coalesce(p_visibility, 'open')` (**7.2 changes that one expression,
        nothing else**); validates `p_visibility in ('open','private')` when supplied;
        inserts one `thread_participants` row for the caller plus one per **distinct** id in
        `p_participant_member_ids`; **raises** if any supplied id is not an active
        `account_members` row of `current_context_id()` — fail fast
        (`.claude/rules/coding-style.md`), and never let a caller believe someone is in a
        conversation who silently was not added. Returns the thread row.

- [ ] **Task 5 — RLS** (AC: 6, 8, 11)
  - [ ] `05_policies.sql`: `enable row level security` on all four new tables.
  - [ ] **`force row level security` — decide it, with evidence, and record the decision.**
        AD-1 requires it; no table in this repo has it, and both `01_tables.sql:142` and
        `05_policies.sql:1090` say so in comments that this diff must correct or leave
        correct. FORCE applies RLS to the **table owner**, which is what `create_thread()`
        runs as — it is bypassed only by a role carrying the `BYPASSRLS` attribute. **Before
        writing `force`, run `select rolname, rolbypassrls from pg_roles where rolname in
        ('postgres','supabase_admin');` on the local stack and paste the result into the
        Completion Notes.** If `postgres` has `rolbypassrls = true`, ship `force` on all
        four tables and update the two stale comments in the same diff. If it does **not**,
        ship without `force`, record why in a comment on each table, and leave both existing
        comments accurate. Do not guess in either direction — an unverified `force` breaks
        every `create_thread()` call in a way no local test with `service_role` fixtures
        would catch.
  - [ ] Weigh the counter-position before deciding: **two places argue against** introducing
        `force` — `05_policies.sql:1090` ("no table in this repo has it… a single forced
        table would diverge from the other 22") and Story `12-2-reminder-delivery.md`'s
        Task 3 ("`force row level security` is not used anywhere in this schema — do not
        introduce it here"). AD-1 argues for it. Epic 7 adds four tables at once, which is
        the first point at which "a single forced table" stops being the objection. Whatever
        this story concludes, **record it in the Completion Notes**: 7.4 and 7.5 follow it
        rather than re-deciding, and 7.5's text says so.
  - [ ] `threads`: SELECT `using (public.thread_is_readable(id))`; INSERT `with check
        (account_id = public.current_context_id() and connection_id is null)`
        (defense-in-depth — the app only ever calls `create_thread()`; see Dev Notes "Why
        the INSERT policy still matters"). No UPDATE/DELETE policy for `authenticated`.
  - [ ] `thread_participants`: SELECT `using (public.thread_is_readable(thread_id))`;
        INSERT `with check (account_id = public.current_context_id() and connection_id is
        null and exists (select 1 from public.thread_participants tp where tp.thread_id =
        thread_participants.thread_id and tp.member_id = public.current_member_id()))` —
        **only an existing participant may add a participant** (AC-8; the initial rows come
        from `create_thread()`, which is definer and unaffected). Without the `exists`, any
        same-account member self-joins any thread and 7.3's privacy is one INSERT away from
        bypassed. No UPDATE/DELETE for `authenticated` in this story (7.5 adds
        `last_read_at` writes through its own RPC).
  - [ ] `messages`: SELECT `using (public.thread_is_readable(thread_id))`; INSERT with the
        same account/connection/participant `with check` shape (AC-8). No UPDATE/DELETE for
        `authenticated` — messages are append-only (AC-4); no Epic 7 AC asks for editing or
        deleting a sent message.

- [ ] **Task 6 — Grants** (AC: 4, 6, 8)
  - [ ] `06_grants.sql`: `revoke all on table public.threads/thread_participants/messages
        from anon;` then `grant select, insert on table … to authenticated;` (**no update,
        no delete** — matching Task 5 everywhere), `grant all … to service_role;`.
  - [ ] Sequences: for each of `threads_id_seq`, `thread_participants_id_seq`,
        `messages_id_seq` — `revoke all on sequence … from anon;` then grant to
        `authenticated` and `service_role`, following the `shidduchim_id_seq` block at
        `06_grants.sql:203-205`, **not** the fork-fossil blocks near the top of the file
        that still grant `anon`.
  - [ ] Function grants: `revoke all on function public.thread_is_readable(bigint),
        public.create_thread(text, bigint, bigint[], text) from public, anon;` then `grant
        execute … to authenticated, service_role;`. Same for `enforce_connection_kinds()`'s
        trigger function (no grant needed; it is invoked by the trigger).

- [ ] **Task 7 — Generate, hand-check and rehearse the migration** (AC: 1-11)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f thread_model`.
        Hand-inspect the generated SQL — `db diff` never re-emits `security_invoker` or
        grants on views and does not diff storage bucket rows (none here), and it has been
        observed to **under-emit a second multi-column FK when a similar one already
        exists**. Confirm by eye: four `create table`s, both composite unique keys on
        `threads`, **both** composite FKs on each of `thread_participants` and `messages`,
        every check constraint, the partial unique index, and (if Task 5 concluded yes)
        four explicit `ALTER TABLE … FORCE ROW LEVEL SECURITY;` statements. Hand-add
        anything missing into the same migration file.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`, then
        `db diff` **twice more** to prove convergence ("No schema changes found" both
        times). Never `db reset` on a stack holding data; never `db push`.
  - [ ] `make check-migration-safety` after extending the fixture (Task 9). Then rehearse
        the migration against a **production-shaped, non-empty** database — every other
        local gate runs against an empty one.

- [ ] **Task 8 — Types, provider, and the `discussions` tab** (AC: 1-9)
  - [ ] `src/components/atomic-crm/types.ts`: `ThreadSubjectType = "shidduch" |
        "relationship"`, `ThreadVisibility = "open" | "private"`, `Thread`,
        `ThreadParticipant`, `Message`, `Connection`, `CreateThreadInput` — the existing
        `Account`/`AccountMember` style exactly (`types.ts:160-179`: plain `type X = {...}
        & Pick<RaRecord, "id">`). `Thread`/`ThreadParticipant`/`Message` each carry
        `account_id?: Identifier | null` **and** `connection_id?: Identifier | null`.
  - [ ] `providers/supabase/dataProvider.ts`: `createThread(input: CreateThreadInput):
        Promise<Thread>` calling `getSupabaseClient().rpc("create_thread", {…})`, following
        `createShidduchViaRpc` at `dataProvider.ts:85-100` verbatim in shape. Plain
        `dataProvider.create("messages", …)` / `getList("messages"|"thread_participants",
        …)` need no wrapper — RLS and the triggers do the rest.
  - [ ] `providers/fakerest/dataProvider.ts` + `dataGenerator/`: `db.threads`,
        `db.thread_participants`, `db.messages`, `db.connections` collections and a FakeRest
        emulation of `createThread` (AD-10 — every new resource/method is mirrored).
  - [ ] New `src/components/atomic-crm/threads/`: `ThreadList.tsx` (threads for a subject)
        and `ThreadPanel.tsx` (messages + a participant-gated composer). Mirrors the
        one-folder-per-resource convention. Keep each file under the ~400-line ceiling.
  - [ ] Wire `discussions` into the **shidduch** descriptor —
        `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` (note: `.tsx`, and its
        `tabs` array is currently complete with `pendingTabs: []` at `:161`). Append the tab
        **at the end**, after `activity`, exactly as the binding contract writes the row:
        *"`overview, resume, photo, medical, files, diligence, external-links, notes, tasks,
        activity` (+ `discussions` appended by 7-1)"*
        [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §3 rule 5]. Any
        other position is `tab-order-drift` from the AD-24 validator.
  - [ ] **The same diff must add `"discussions"` to `CANONICAL_TAB_SETS.shidduchim` in
        `src/components/atomic-crm/entity360/ad24Conformance.ts:210-221`**, at the end of
        the row — or `tab-set-incomplete` fires (that code is live and the validator runs on
        all its violation codes). Key and row widen together.
  - [ ] **Do not touch `entity360/tabKeys.ts`, `englishCrmMessages.ts` or
        `frenchCrmMessages.ts` for the tab *label*.** `discussions` is already in `TAB_KEYS`
        and `TAB_LABELS` (`tabKeys.ts`) and already has a `crm.entity360.tab.discussions`
        entry in **both** catalogues (`englishCrmMessages.ts:420`,
        `frenchCrmMessages.ts:394` — the French catalogue is genuinely translated, not an
        English mirror). Re-adding them is a duplicate-key edit.
  - [ ] **Omit `visibleTo` entirely** on the tab. Contract §2 rule 7: the field is
        `visibleTo?: MemberRole[]`, an allow-list, and an absent `visibleTo` means visible
        to every role; there is no `minVisibility` (it was deleted). Do **not** write
        `visibleTo: []`, which denies every role. Which *rows* a viewer sees is
        `thread_is_readable()`'s job at the database, and an empty tab for a role is
        correct, not a leak — and unlike the five tabs Story 6.3 hid, this one is **not**
        permanently empty for a `single`: AC-9 gives a single real, readable threads.
        Declare **no** `label` override (§2 rule 8 — an override without a
        "why-this-entity-deviates" comment is a review-blocking defect).
  - [ ] All new UI strings through the `i18nProvider` (AD-18) — add a `threads:` block under
        the `crm` root in **both** `englishCrmMessages.ts` and `frenchCrmMessages.ts`,
        following the shape of the existing sibling blocks.
  - [ ] Do **not** build a bespoke tab shell: `Entity360`/`EntityShow`/`buildEntityRoutes`
        already serve `/shidduchim/{id}/discussions`. No standalone `/threads` route and no
        `RESOURCES` entry is added by this story — nothing in `epics.md` 7.1–7.5 asks for a
        thread inbox, and `subject_type='relationship'` threads have no surface yet. Say so
        rather than inventing one.

- [ ] **Task 9 — Tests** (AC: 5, 6, 8, 9, 10, 11, 12)
  - [ ] New `supabase/tests/threads_entity.sql` + `threads_entity.test.ts`, following
        `references_entity.sql`'s shape (`results`/`ids` temp tables, one assertion row per
        check, rollback at the end, run via `npm run test:unit:db`). **Never
        `exception when others then … PASS`** — match the specific SQLSTATE for every
        denial, prove each denial by mutation, and separately prove an *unrelated* failure
        still fails. Cover:
        - `create_thread()` creates the thread + the creator participant row;
        - `create_thread()` raises on a participant id from another account;
        - a `subject_type='shidduch'` thread rejects a `subject_id` from another account;
        - the XOR check: both scope columns set → `23514`; neither set → `23514` (AC-5);
        - a non-participant same-account member cannot INSERT into `messages`;
        - a non-participant cannot INSERT a `thread_participants` row adding **themselves**
          (the AC-8 self-join gate);
        - **AC-9, the three sub-cases**: a `single` participant reads an open thread on
          their **own** shidduch with `visibility='shared'` and a single-visible state; and
          reads **zero rows** for (a) a sibling's shidduch and (b) their own shidduch with
          `visibility='private_parent'` — both with a single-visible pipeline state, so the
          state clause alone cannot be what passes;
        - AC-10: deleting the subject `shidduchim` row deletes the account-scoped thread
          **and** a service-role-seeded connection-scoped thread on the same subject, plus
          their messages/participants;
        - AC-6: an authenticated client insert into `connections` affects zero rows;
        - **AC-11**: one login, memberships in accounts A and B, active in A — reads zero
          rows of B's `threads`/`messages`/`thread_participants`.
  - [ ] **Extend `supabase/tests/migration-data-safety/fixture.sql`**: seed and
        `migration_guard.capture(...)` all four new tables (the capture list is at
        `:488-509`; nothing outside it is checked). This is not optional — 7.5 alters
        `thread_participants` and Epic 8 alters `connections`, and the guard was
        structurally blind to `invites` for exactly this reason.
  - [ ] Vitest (browser mode, `vitest-browser-react` + `TestMemoryRouter` from `ra-core` in
        real Chromium — **React Testing Library is not a dependency**) for `ThreadPanel`,
        `ThreadList` and the FakeRest emulation, ≥80% of new lines
        (`.claude/rules/testing.md`), AAA-structured, no `waitForTimeout`.
  - [ ] An e2e spec in `e2e/` covering open → post → read on a shidduch's Discussions tab,
        using `e2e/fixtures.ts`'s stack-scoped fixture. `make start-app-e2e` with a
        `STACK_ID` in 1-6 **plus** `STACK_OWNER=<label>`; never `make start-e2e-ci`; stop
        the stack afterwards.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        `npx prettier --config ./.prettierrc.json --check` over this story's changed files
        only (repo-wide prettier is not this story's gate).

## Dev Notes

### What this story does *not* do (own it, don't blur it)

This story's RLS makes `threads`/`messages`/`thread_participants` readable to any current
member of the owning account (subject to AC-9's dignity-floor gate for a `single`)
**regardless of `visibility`**. A `'private'` thread exists as data from this story onward,
but nothing yet restricts its readership to participants — that is **7.3's** acceptance
criterion. Do not add a participant-only branch to `thread_is_readable()` here. Safe to ship
as an interim state only because no user reaches any of this before 7.2/7.3 land: the tab is
built here, so **7.1–7.3 deploy together or the Discussions tab ships with `private` as a
lie**. Say so at deploy time.

The connection axis is likewise *structural only* here: `thread_is_readable()` returns false
for any connection-scoped thread and every INSERT policy requires `connection_id is null`,
so `authenticated` cannot create, read or write one. 7.4 is a pure widening.

### Why posting is participant-gated even on open threads

AD-22 says an `open` thread is readable by "all parties in its context" — but this story's
own AC ("attached to a subject… with **explicit participants**") only means something if
participants are a load-bearing list, not a decoration. The resolution: **read** access is
governed by scope + visibility (AD-1/AD-3/AD-22); **write** access is always governed by the
explicit participant list, independent of visibility. A household is transparent by default
(anyone may *see* an open conversation) but only the people in it may *speak* in it — like a
family overhearing a conversation without being part of it. That is why every thread records
participants from creation, even open ones.

### The dignity floor composes with Epic 6; it is not re-derived

Story 6.2 shipped the single's row-level scoping as a **two-policy pattern**: the existing
`for all` policy gained `and public.current_member_role() <> 'single'`, and a second,
SELECT-only policy grants the single exactly the rows AC-9 enumerates
(`05_policies.sql:352-367` for `shidduchim`; the same three-clause shape recurs for
`resumes`, `shidduch_schools` and friends at `:399`, `:464`, `:494`, `:604`, `:867`). 6.3
then added the field-level scoping and the `single_input` carve-out (`interactions.kind =
'single_input'`, `05_policies.sql:826-870`) — the un-lowerable "and can give input" half of
AD-3/FR93.

Two consequences for this story:

1. **Reuse the three-clause test, not one clause of it.** An earlier revision of this story
   specified only `is_single_visible_state(shidduchim.pipeline_state)`. That is a leak in
   any household with two singles, and in any household using `private_parent` visibility.
   AC-9 exists to make it falsifiable.
2. **Do not put threads behind a `current_member_role() <> 'single'` blanket deny.** Threads
   are not a diligence artefact; a single participating in a thread about their own live
   shidduch is precisely the dignity floor Epic 6 protects. The `discussions` tab therefore
   carries **no** `visibleTo` restriction, unlike the five tabs 6.3 hid because their tables
   are permanently empty for a single.

### Why the INSERT policy still matters despite `create_thread()` being SECURITY DEFINER

`create_thread()` runs as its owner (`postgres`, like every other definer function here,
e.g. `create_shidduch()`), and Supabase's `postgres` role carries `BYPASSRLS` — that
attribute, not superuser status, is why the RPC's inserts are unaffected by these policies,
**and it is what Task 5 makes you verify before writing `force`**. The `with check` INSERT
policies are defense-in-depth for the case nobody expects: a direct
`dataProvider.create("threads", …)`. They should never fire in normal operation.

### The dual-axis composite-FK trick, spelled out

For a child table `T` referencing a dual-axis parent `P`:

```sql
alter table public.P
  add constraint p_account_id_id_key    unique (account_id, id),
  add constraint p_connection_id_id_key unique (connection_id, id);

alter table public.T
  add constraint t_p_id_fkey_account
    foreign key (account_id, p_id)    references public.P(account_id, id)    on delete cascade,
  add constraint t_p_id_fkey_connection
    foreign key (connection_id, p_id) references public.P(connection_id, id) on delete cascade;
```

`MATCH SIMPLE` (the default) satisfies a multi-column FK trivially — without checking — if
**any** of its own columns is NULL. So on an account-scoped row of `T` (`connection_id`
NULL) only `t_p_id_fkey_account` does work, and the reverse on a connection-scoped row. Both
constraints must exist for "exactly one axis is real" to be enforced by the database rather
than assumed. Note what this does **not** give you: it does not stop `T` pointing at a
`threads` row on the *other* axis with the same `id`, because that FK is simply unchecked —
the `<table>_scope_check` XOR plus the triggers copying the parent's axis (Task 3) are what
close that, which is why Task 9 asserts it directly.

### References

Full paths, per contract §0 — two files share the bare name `ARCHITECTURE-SPINE.md` and the
other one has no AD-20/22/23/24.

- [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-22`]
  — thread = structured, subject-scoped, explicit participants, one visibility; resolution
  rule 3 ("a thread carries exactly one scope").
- [Source: same file `#AD-1`] — every domain row scoped by exactly one of `account_id` /
  `connection_id`; FORCE RLS; no `anon` grants; a table's RLS lands in its own migration.
- [Source: same file `#AD-20`] — the connection as a third scope, owned by neither party.
- [Source: same file `#AD-3`] — one visibility authority, extended to child tables by
  join-to-parent RLS; the un-lowerable floor.
- [Source: same file `#AD-4`] — the "one creation path" precedent (`create_shidduch()`).
- [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §2 rules 7-8, §3 rule 5,
  §8 rule 6, §13 rules 3 and 5] — `visibleTo` is an allow-list, no `minVisibility`; the
  canonical shidduch tab row with `discussions` appended by this story; `pg_dump` function
  form; one-login-two-contexts negatives; ≥80% coverage.
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic-7-Communication`, Story 7.1]
- `supabase/schemas/01_tables.sql:1-60` (COLUMN-ORDER TRAP), `:162-190` (`accounts`, `kind`
  at the tail), `:272-285` (`singles`, `member_id`), `:326-372` (`shidduchim`, incl.
  `single_id`, `visibility`, `owner_member_id`, and the `close_reason` column-grant
  warning), `:835-844` (composite `(account_id, id)` key block), `:1031-1082` (index block).
- `supabase/schemas/02_functions.sql:249` (`current_context_id`), `:290`
  (`current_member_id`), `:316` (`current_member_role`), `:461` (`set_account_id_default` —
  the trigger-function style to match), `:1484` (`is_single_visible_state`), `:1666`
  (`create_shidduch`), `:2466` (`purge_polymorphic_dependents` — extended, not duplicated).
- `supabase/schemas/05_policies.sql:352-367` (the shipped single-visibility three-part
  test), `:1048-1063` + `06_grants.sql:847-858` (`subscription`/`ai_usage` — the
  read-only-to-`authenticated`, service-role-writes precedent `connections` copies),
  `:1090` (the "no table in this repo has FORCE" comment this story must leave accurate).
- `supabase/schemas/06_grants.sql:203-205` (sequence grant convention), `:290-292`
  (function-grant convention).
- `supabase/tests/references_entity.sql` (SQL suite shape),
  `supabase/tests/migration-data-safety/fixture.sql:488-509` (the capture list to extend).
- `src/components/atomic-crm/entity360/tabKeys.ts` (`discussions` already in the union),
  `entity360/ad24Conformance.ts:209-242` (`CANONICAL_TAB_SETS`),
  `shidduchim/entityDescriptor.tsx` (`pendingTabs: []` at `:161`),
  `providers/supabase/dataProvider.ts:85-100` (`createShidduchViaRpc`),
  `providers/commons/englishCrmMessages.ts:405-422` /
  `frenchCrmMessages.ts:379-396` (tab labels already present in both).

## Dependencies

- **Epics 1-6, all deployed** (`origin/main` = `11904a1`, 76 migrations). Nothing here is a
  forward reference.
- **Blocks 7.2, 7.3, 7.4, 7.5.** Every one of them extends this story's tables or functions.
- **Blocks Epic 8 Story 8.2** in the sense that 8.2 must `ALTER`, not create, `connections`.
- **Deploy coupling:** 7.1-7.3 deploy together (see "What this story does not do").

## Declared file set

Every declared file set in this project has been too small. This one includes the ones that
are always forgotten.

**Schema / DB**
`supabase/schemas/01_tables.sql`, `02_functions.sql`, `04_triggers.sql`, `05_policies.sql`,
`06_grants.sql`, one new `supabase/migrations/<ts>_thread_model.sql`,
`supabase/tests/threads_entity.sql`, `supabase/tests/threads_entity.test.ts`,
`supabase/tests/migration-data-safety/fixture.sql`.

**Types / providers**
`src/components/atomic-crm/types.ts`,
`src/components/atomic-crm/providers/supabase/dataProvider.ts`,
`src/components/atomic-crm/providers/fakerest/dataProvider.ts`,
`src/components/atomic-crm/providers/fakerest/dataGenerator/**`,
`src/components/atomic-crm/providers/commons/englishCrmMessages.ts`,
`src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`.

**UI**
`src/components/atomic-crm/threads/ThreadList.tsx`,
`src/components/atomic-crm/threads/ThreadPanel.tsx`, their `.test.tsx` siblings,
`src/components/atomic-crm/threads/index.ts`,
`src/components/atomic-crm/shidduchim/entityDescriptor.tsx`,
`src/components/atomic-crm/shidduchim/entityDescriptor.test.tsx`.

**Shared guards / generated**
`src/components/atomic-crm/entity360/ad24Conformance.ts` and its
`ad24Conformance.test.ts`, `registry.json` (regenerated by the pre-commit
`make registry-gen` — commit it, do not hand-edit), `e2e/<new>.spec.ts`, `e2e/fixtures.ts`
if a new seed helper is needed.

No `root/routeManifest.ts` change (no new `RESOURCES` entry — Task 8).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
