# Story 7.1: Thread model

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want threads modelled as subject-scoped, structured records — never free-form chat —
so that permission and history are tractable for every persona pair (FR94, FR95).

## Position in Epic 7

**1st of 5.** This story lays the schema every other Epic 7 story extends:

7.1 (this story) → 7.2 (default posture) → 7.3 (private enforcement) → 7.4 (connection scope) → 7.5 (notifications)

- **7.2** adds `accounts.default_thread_visibility` and teaches `create_thread()` to read it.
- **7.3** adds the participant-only branch to `thread_is_readable()` and a
  `set_thread_visibility()` RPC — this story's RLS deliberately does **not** yet
  distinguish `open` from `private` (see Dev Notes "What this story does not do").
- **7.4** widens `threads`/`thread_participants`/`messages` from account-only to the
  dual `account_id`/`connection_id` scope and creates the bare `connections` table.
- **7.5** adds `thread_participants.last_read_at`, `message_notifications`, and delivery.

### Assumed to have already landed (Epics 1–6, per the pinned epic order)

- Epic 1: `children`→`singles` (this story still writes `child_id`/`children` in
  examples where they mirror **today's** schema at time of writing — see Dev Notes
  "Naming note" for how to translate).
- Epic 2 Story 2.1: `current_account_id()` is deleted; **`current_context_id()`** is
  the resolver (`STABLE SECURITY DEFINER SET search_path ''`, fails closed, AD-19).
  Every reference below to `current_context_id()` is to that function.
- Epic 2 Story 2.2: `accounts.kind` exists (`household | shadchanus`) and the role
  check includes `'single'` (2.2 AC-2 — today's constraint is
  `('parent_admin','helper','self_manager','shadchan')`, no `'single'` yet,
  `01_tables.sql:271-273`). **Note: Epic 2 does NOT retrofit `FORCE ROW LEVEL
  SECURITY` repo-wide** — Story 2.1 explicitly flags that as an unassigned AD-1 gap
  (`main` today has no `force` anywhere in `05_policies.sql`). This story ships its
  own three new tables with `force row level security` from day one regardless; it
  does not touch existing tables.
- Epic 3 Story 3.5: **`public.current_member_id()`** exists (`STABLE SECURITY
  DEFINER`, resolves the caller's own `account_members.id` in the active context) —
  this story's triggers and policies reuse it, never re-resolve the member inline.
- Epic 6: **`public.current_member_role()`** exists (6.2), and row-level scoping for
  the single role is established on existing tables (`shidduchim`/`resumes` in 6.2,
  `interactions` and friends in 6.3). **This story is the first to add the
  single-visibility gate to a brand-new table** — there is no line to copy, only the
  pattern (join to the parent `shidduchim` row, call `is_single_visible_state()`),
  described below.

If any of these have not actually landed when this story is picked up, stop and
report — do not invent a local substitute for `current_context_id()`,
`current_member_id()`, `current_member_role()` or the single role.

## Acceptance Criteria

1. **A thread is a real table, not a free-text field.** `public.threads` exists with
   `subject_type` ∈ `('shidduch', 'relationship')` and `subject_id` — non-null and
   pointing at a `shidduchim` row in the same account when `subject_type='shidduch'`;
   null when `subject_type='relationship'` (a general household conversation not tied
   to one suggestion). No other subject type exists yet (AD-22, FR95).

2. **A thread carries explicit participants.** `public.thread_participants` records
   which `account_members` rows are in the conversation. Every thread has at least one
   participant row (its creator) from the moment it is created; nothing reads
   "everyone in the account" implicitly.

3. **Visibility is a property of the thread, not derived at read time.**
   `public.threads.visibility` ∈ `('open', 'private')`, defaulting to `'open'`
   (`'private'` is fully modelled by this story's schema; its *enforcement* is 7.3's
   job — see Dev Notes).

4. **Messages are structured rows scoped to a thread**, not appended to a generic
   notes/interactions timeline. `public.messages(thread_id, sender_member_id, body,
   created_at)` exists; a message is never editable or deletable through the
   dataProvider (no UPDATE/DELETE RLS policy for `authenticated`).

5. **One creation path.** `public.create_thread(p_subject_type, p_subject_id,
   p_participant_member_ids, p_visibility default null)` is the sole way a thread and
   its initial participants are inserted together; the SPA never calls
   `dataProvider.create("threads", …)` directly (mirrors AD-4's `create_shidduch()`
   precedent). It validates `p_subject_type`, validates a `shidduch` subject exists in
   the caller's own active account, and always includes the caller as a participant.

6. **Posting and participant changes are participant-gated.** Only a listed
   `thread_participants` row for the caller's own membership allows an INSERT into
   `messages` for that thread — regardless of the thread's `visibility` (open threads
   are *readable* more broadly per AD-3/AD-22 rule 2, but *posting* is always
   participant-only; see Dev Notes "Why posting is participant-gated even on open
   threads"). Likewise, only an existing participant may INSERT a new
   `thread_participants` row for that thread — a same-account member can never add
   *themselves* to a conversation they are not in. Without this, 7.3's privacy would
   be decorative: any member could self-join a private thread and then read it.

7. **Tenant isolation holds from the first migration.** `threads`, `thread_participants`
   and `messages` all have `FORCE ROW LEVEL SECURITY`; a member of account A gets zero
   rows from account B's threads, participants or messages (negative test, AC-9).

8. **A deleted shidduch takes its threads with it.** Deleting a `shidduchim` row
   deletes its `subject_type='shidduch'` threads (and, via `ON DELETE CASCADE`, their
   participants and messages) through the **existing**
   `purge_polymorphic_dependents()` trigger function — not a new one.

9. **Verification — the toolchain is green and the negative test passes.**
   `make typecheck`, `npm run lint`, `make test` pass repo-wide with zero new
   warnings. `npm run test:unit:db` (needs `make start`) passes, including a new
   negative-RLS assertion in `supabase/tests/threads_entity.sql`: two accounts, each
   with one thread/message; a member of account A reading `threads`, `messages` and
   `thread_participants` gets **zero** rows belonging to account B.

## Tasks / Subtasks

- [ ] **Task 1 — Declare the three tables in the schema** (AC: 1, 2, 3, 4)
  - [ ] `supabase/schemas/01_tables.sql`: add `public.threads` (`account_id bigint not
        null`, `subject_type text not null`, `subject_id bigint`, `visibility text not
        null default 'open'`, `created_by_member_id bigint`, `created_at`) with
        `threads_subject_type_check`, `threads_subject_id_check` (the paired-null rule
        in AC-1), `threads_visibility_check check (visibility in ('open','private'))`.
  - [ ] Add `public.thread_participants` (`account_id bigint not null`, `thread_id
        bigint not null`, `member_id bigint not null`, `created_at`).
  - [ ] Add `public.messages` (`account_id bigint not null`, `thread_id bigint not
        null`, `sender_member_id bigint`, `body text not null`, `created_at`), with
        `messages_body_not_blank_check check (btrim(body) <> '')`.
  - [ ] Composite-FK plumbing, following the exact `(account_id, id)` pattern used for
        every other shidduchim-domain table (`01_tables.sql:654-666`,
        `shidduchim_account_id_id_key` etc.): add
        `threads_account_id_id_key unique (account_id, id)`; FK `threads_account_id_fkey`
        → `accounts(id) on delete cascade`; FK `threads_created_by_member_id_fkey` →
        `account_members(id) on delete set null` (nullable column, matching
        `shidduchim.owner_member_id` / `interactions.actor_member_id`'s convention —
        `01_tables.sql:365-366`, `521`).
  - [ ] `thread_participants`: FK `(account_id, thread_id)` → `threads(account_id, id)
        on delete cascade`; FK `member_id` → `account_members(id) on delete cascade`
        (a participant row has no meaning without its member — unlike
        `owner_member_id`/`actor_member_id`, this is a join row, so cascade, not set
        null); unique `(thread_id, member_id)`.
  - [ ] `messages`: FK `(account_id, thread_id)` → `threads(account_id, id) on delete
        cascade`; FK `sender_member_id` → `account_members(id) on delete set null`.
  - [ ] Indexes: `threads_account_id_idx`, `threads_subject_idx (account_id,
        subject_type, subject_id)`, `thread_participants_account_id_idx`,
        `thread_participants_member_id_idx`, `messages_account_id_idx`,
        `messages_thread_id_idx (thread_id, created_at)` — same style as the existing
        FK-index block at `01_tables.sql:792-820`.

- [ ] **Task 2 — Triggers: server-set scope, never client-trusted** (AC: 5, 6, 7)
  - [ ] `supabase/schemas/02_functions.sql`: `set_thread_defaults()` (`before insert on
        threads`) — sets `account_id := public.current_context_id()` when null, and
        `created_by_member_id := public.current_member_id()` when null (reuse Epic 3
        Story 3.5's function — do **not** re-resolve the member with an inline
        `account_members` query; the older inline pattern in `log_reference_call`
        predates `current_member_id()` and is not the template here).
  - [ ] `set_thread_participant_defaults()` (`before insert on thread_participants`) —
        sets `account_id` from the parent thread (`select account_id from threads
        where id = new.thread_id`) when null. Never trusts a client-sent
        `account_id`.
  - [ ] `set_message_defaults()` (`before insert on messages`) — sets `account_id`
        from the parent thread and `sender_member_id := public.current_member_id()`,
        both when null.
  - [ ] `supabase/schemas/04_triggers.sql`: wire all three as `before insert` triggers,
        next to the other `set_*_account_id` triggers.
  - [ ] Extend the **existing** `purge_polymorphic_dependents()` function
        (`02_functions.sql:1199-1217`) with a fourth delete:
        `delete from public.threads where account_id = old.account_id and
        subject_type = v_target_type and subject_id = old.id;`. Do **not** write a new
        trigger — this function is already attached via `purge_shidduch_dependents`
        (`04_triggers.sql:156-158`) and `purge_reference_dependents`
        (`04_triggers.sql:147-149`); the `'reference'` call becomes a no-op delete for
        `threads` since no thread ever has `subject_type='reference'`. Satisfies AC-8.

- [ ] **Task 3 — `thread_is_readable()` and `create_thread()`** (AC: 1, 5, 6, 7)
  - [ ] Add `public.thread_is_readable(p_thread_id bigint) returns boolean` —
        `STABLE SECURITY DEFINER SET search_path ''`, the **one authority** this and
        every later Epic 7 story's RLS calls (mirrors `is_single_visible_state()` being
        "the ONE authority", `02_functions.sql:573-577`). This story's body: return
        `false` if the thread's `account_id` isn't `current_context_id()`; for
        `subject_type='shidduch'`, if `public.current_member_role() = 'single'`,
        additionally require
        `is_single_visible_state(shidduchim.pipeline_state)` on the subject row
        (dignity floor, AD-22 resolution rule 2 — "open never widens AD-3"); otherwise
        readable. **Do not yet branch on `visibility`** — see Dev Notes.
  - [ ] Add `public.create_thread(p_subject_type text, p_subject_id bigint default
        null, p_participant_member_ids bigint[] default '{}', p_visibility text
        default null) returns public.threads` — `SECURITY DEFINER SET search_path ''`.
        Validates `p_subject_type in ('shidduch','relationship')`; for `'shidduch'`,
        `exists (select 1 from shidduchim where id = p_subject_id and account_id =
        current_context_id())` or raise; inserts the thread row with
        `visibility := coalesce(p_visibility, 'open')` (7.2 changes this line only);
        inserts one `thread_participants` row for the caller plus one per id in
        `p_participant_member_ids` (dedup via `distinct`); **raise** if any supplied
        id is not an active `account_members` row of the same account — fail fast
        (`.claude/rules/coding-style.md` input validation), and never let the caller
        believe someone is in a conversation who silently was not added. Returns the
        thread row.

- [ ] **Task 4 — RLS** (AC: 6, 7)
  - [ ] `supabase/schemas/05_policies.sql`: `alter table threads/thread_participants/
        messages enable row level security` **and** `force row level security` (the
        first tables in the repo to ship `force` from day one — see "Assumed to have
        already landed").
  - [ ] `threads`: SELECT policy `using (thread_is_readable(id))`; INSERT policy
        `with check (account_id = current_context_id())` (defense in depth — the app
        only ever calls `create_thread()`, which is SECURITY DEFINER and runs as the
        function owner, bypassing RLS the same way `create_shidduch()` does today; see
        Dev Notes "Why the INSERT policy still matters"). No UPDATE/DELETE policy for
        `authenticated`.
  - [ ] `thread_participants`: SELECT `using (thread_is_readable(thread_id))`; INSERT
        `with check (account_id = current_context_id() and exists (select 1 from
        thread_participants tp where tp.thread_id = thread_participants.thread_id and
        tp.member_id = public.current_member_id()))` — **only an existing participant
        may add a participant** (AC-6; the initial rows come from `create_thread()`,
        which is SECURITY DEFINER and unaffected). Without the `exists`, any
        same-account member could self-join any thread and 7.3's privacy would be
        bypassable by one INSERT. No UPDATE/DELETE for `authenticated` in this story
        (7.5 adds `last_read_at` writes via its own RPC).
  - [ ] `messages`: SELECT `using (thread_is_readable(thread_id))`; INSERT `with check
        (account_id = current_context_id() and exists (select 1 from
        thread_participants tp where tp.thread_id = messages.thread_id and
        tp.member_id = public.current_member_id()))` (AC-6). No UPDATE/DELETE for
        `authenticated` (AC-4 — messages are append-only; there is no Epic 7 AC for
        editing or deleting a sent message).

- [ ] **Task 5 — Grants** (AC: 6, 7)
  - [ ] `supabase/schemas/06_grants.sql`: `revoke all on table
        threads/thread_participants/messages from anon;` then `grant select, insert on
        table threads to authenticated;` (no update/delete — matches Task 4's "no
        UPDATE/DELETE for authenticated" everywhere in this story), same for
        `thread_participants` and `messages`; `grant all … to service_role;` on all
        three. Sequence grants for `threads_id_seq`, `thread_participants_id_seq`,
        `messages_id_seq`: `revoke all … from anon;` then grant to
        `authenticated`/`service_role` — the convention used for every
        shidduchim-domain sequence (the `shidduchim_id_seq` block in `06_grants.sql`,
        **not** the fork-fossil blocks near the top of the file that still grant
        `anon`). Function grants: `revoke all on function thread_is_readable,
        create_thread from public, anon;` then `grant execute … to authenticated,
        service_role;`.

- [ ] **Task 6 — Generate and hand-check the migration** (AC: 1–8)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        thread_model` then hand-check: `db diff` is known to drop `security_invoker`
        and REVOKE statements on views (not relevant here, no view is added) but also
        frequently misses `FORCE ROW LEVEL SECURITY` — confirm the generated migration
        contains `ALTER TABLE public.threads FORCE ROW LEVEL SECURITY;` (and the other
        two) explicitly; add it if missing.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset`, never `db push`.

- [ ] **Task 7 — Types and provider** (AC: 1–6)
  - [ ] `src/components/atomic-crm/types.ts`: add `ThreadSubjectType = "shidduch" |
        "relationship"`, `ThreadVisibility = "open" | "private"`, `Thread`,
        `ThreadParticipant`, `Message`, `CreateThreadInput` — follow the existing
        `Shidduch`/`AccountMember` style exactly (plain `type X = {...} &
        Pick<RaRecord,"id">`).
  - [ ] `providers/supabase/dataProvider.ts`: add `createThread(input:
        CreateThreadInput): Promise<Thread>` calling
        `getSupabaseClient().rpc("create_thread", { p_subject_type: …, p_subject_id:
        …, p_participant_member_ids: …, p_visibility: … })`, following the exact
        `createShidduchViaRpc` shape (`dataProvider.ts:71-100`). Plain
        `dataProvider.create("messages", …)` / `getList("messages", …)` /
        `getList("thread_participants", …)` need no custom wrapper — RLS and the
        triggers do the rest.
  - [ ] `providers/fakerest/dataProvider.ts` + `dataGenerator/`: add `db.threads`,
        `db.thread_participants`, `db.messages` collections and a fakerest emulation of
        `createThread` (AD-10 — every new resource/method is mirrored in FakeRest).

- [ ] **Task 8 — Minimal UI to prove the model** (AC: 1–6)
  - [ ] Add `src/components/atomic-crm/threads/` (mirrors `references/`,
        `shadchanim/`): a `ThreadPanel` (list of messages + a composer, participant
        gated) and a `ThreadList` (threads for a given subject). Wire them in as a new
        `discussions` tab on the **shidduch entity descriptor** (Epic 3 Story 3.3's
        registry; the shidduch descriptor is registered by Epic 5 Story 5.1 and its
        tab set extended by 5.3–5.6 — this story appends `discussions` after
        `external-links`). Declare no `minVisibility` on the tab (3.4's mechanism):
        which *rows* a viewer sees is `thread_is_readable()`'s job at the database,
        and an empty tab for a role is correct, not a leak. Do **not** build a bespoke
        tab shell — Entity360/URL-backed tabs (3.1/3.2) already handle
        `/shidduchim/{id}/discussions`. The tab id `discussions` is a placement call
        this story makes (no epics.md AC pins it); flagged in the final report.
  - [ ] All UI strings through the `i18nProvider` (AD-18) — add a `threads:` block to
        `englishCrmMessages.ts` (and the French mirror, English keys) following the
        `shidduchim:`/`children:` block shape (`englishCrmMessages.ts:1-30`).
  - [ ] No dedicated route is added yet for `subject_type='relationship'` general
        threads — out of scope for this story (nothing in epics.md 7.1–7.5 asks for a
        standalone `/threads` inbox); a future story or correct-course can add one.

- [ ] **Task 9 — Tests** (AC: 9)
  - [ ] New `supabase/tests/threads_entity.sql` + `threads_entity.test.ts`, following
        the exact `references_entity.sql` shape (`results`/`ids` temp tables, one
        assertion row per check, rollback at the end, run via `npm run test:unit:db`).
        Cover: `create_thread()` creates a thread + creator participant;
        `create_thread()` raises on a participant id from another account; a
        `subject_type='shidduch'` thread rejects a `subject_id` from another account;
        a non-participant cannot INSERT into `messages` for that thread even though
        they're in the same account; a non-participant cannot INSERT a
        `thread_participants` row adding **themselves** to that thread (the AC-6
        self-join gate); deleting the subject `shidduchim` row deletes the
        thread (and cascades to messages/participants); **and the mandatory negative
        RLS test (AC-9):** two accounts, one thread+message each — account A's client
        reads zero rows of account B's `threads`/`messages`/`thread_participants`.
  - [ ] Vitest coverage for `ThreadPanel`/`ThreadList`/the fakerest emulation, ≥80% of
        new lines (`.claude/rules/testing.md`), AAA-structured.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        `npx prettier --config ./.prettierrc.json --check` over this story's changed
        files only (repo-wide prettier is not this story's gate — same accepted-debt
        pattern as Epic 1's stories 1.1–1.5).

## Dev Notes

### What this story does *not* do (own it, don't blur it)

This story's RLS makes `threads`/`messages`/`thread_participants` readable to any
current member of the owning account (subject to the AC-1 dignity-floor gate for a
`single`) **regardless of `visibility`**. A `'private'` thread exists as data from this
story onward, but nothing yet restricts its readership to participants — that is
**Story 7.3's** acceptance criterion ("privacy is enforced at the database"). Do not
add a participant-only branch to `thread_is_readable()` here; extending it is 7.3's
job, stated explicitly so it isn't done twice or skipped. This is safe to ship as an
interim state because no user-facing capability in this story lets anyone create a
thread they'd expect to be private and have it actually treated as such — 7.2/7.3 land
before any of this reaches a real user.

### Why posting is participant-gated even on open threads

AD-22 says an `open` thread is readable by "all parties in its context" — but Story
7.1's own AC ("attached to a subject… with **explicit participants**") only makes
sense if participants are a real, load-bearing list, not a decoration. The resolution
this story takes: **read** access is governed by scope + visibility (AD-1/AD-3/AD-22);
**write** access (posting a message) is always governed by the explicit participant
list, independent of visibility. A household is transparent by default (anyone can
*see* an open conversation), but only the people actually in it can *speak* in it —
exactly like a family being able to overhear a conversation without being part of it.
This is why every thread needs participants recorded from creation, even open ones.

### Why the INSERT policy still matters despite `create_thread()` being SECURITY DEFINER

`create_thread()` runs as its owner (`postgres` — like every other SECURITY DEFINER
function in this schema, e.g. `create_shidduch()`). Supabase's `postgres` role is
**not** a superuser but carries the `BYPASSRLS` attribute, which bypasses row
security even under `FORCE` — that attribute, not superuser status, is why the RPC's
inserts are unaffected by these policies. The `with check (account_id =
current_context_id())` INSERT policy on `threads` is defense-in-depth for the case
nobody expects to use: a direct `dataProvider.create("threads", …)` call. It should
never fire in normal operation.

### The dignity-floor gate — first time this pattern is written for a new table

Every other place `is_single_visible_state()` gates a join (today: nowhere yet in
`main` — the codebase's own comment at `05_policies.sql:183-187` on `interactions`
still says "Today every authenticated member of an account is a parent/helper… When
the candidate portal and the `child` role land… this join is the ONE place that gains
`is_child_visible_state`" — that landing is Epic 6's job, which precedes this story).
By the time Epic 7 runs, Epic 6 will have written that gate onto the pre-existing
tables (`shidduchim`/`resumes` in 6.2, `interactions` and the other candid child
tables in 6.3); **this story writes the equivalent gate onto `threads` for the
first time**, since `threads` didn't exist when Epic 6 ran. Copy the *pattern* (join to
`shidduchim`, call `is_single_visible_state(pipeline_state)`, deny by default), not any
literal line — there is no line to copy yet, because this is the first application of
it to a brand-new table rather than a rewrite of an old one.

### Naming note (Epic 1 has already landed by the time this runs)

Everything cited above from `main` today (`children`, `child_id`, `is_child_visible_state`)
will read `singles`/`single_id`/`is_single_visible_state` once Epic 1 Story 1.3 lands.
This story is written against the **post-Epic-1** names throughout its own AC/Tasks
(`is_single_visible_state`, the `'single'` role) — the line/section citations into
`main`'s current schema are given so the developer can locate the *place*, understanding
the identifier there will already be renamed.

### Composite-FK pattern for a dual-axis table (forward reference for 7.4)

`threads.account_id` is `NOT NULL` in this story. Story 7.4 will make it nullable, add
`connection_id`, and add a second composite unique key `(connection_id, id)` alongside
this story's `(account_id, id)`, using Postgres's `MATCH SIMPLE` FK semantics (a FK
with any NULL column is not checked) so exactly one of the two composite FKs on each
child table is ever "live" per row. Nothing in this story needs to anticipate that
beyond leaving `account_id` as an ordinary (renameable-later-to-nullable) column — do
not pre-emptively add `connection_id` now; YAGNI, and it would ship an always-null
column with no consumer for three stories.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-22] — thread = structured, subject-scoped,
  explicit participants, one visibility.
- [Source: ARCHITECTURE-SPINE.md#AD-1] — every domain row scoped by exactly one axis;
  FORCE RLS; no anon grants.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — single-source-of-truth visibility function,
  extended to every child table via join-to-parent RLS.
- [Source: ARCHITECTURE-SPINE.md#AD-4] — the "one creation path" precedent
  (`create_shidduch()`) this story's `create_thread()` follows.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "Isolation is
  enforced in Postgres, never in the application."
- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.1-Thread-model]
- `supabase/schemas/01_tables.sql:332-376` (`shidduchim` — the composite-FK and
  visibility-column precedent), `:499-521` (`interactions` — the polymorphic
  `target_type`/`target_id` precedent for `subject_type`/`subject_id`).
- `supabase/schemas/02_functions.sql:496-577` (`set_sales_id_default`,
  `current_account_id`, `set_account_id_default`, `is_child_visible_state` — the
  function-style precedents this story's new functions match verbatim in shape).
- `supabase/schemas/02_functions.sql:1199-1217` (`purge_polymorphic_dependents` —
  extended, not duplicated).
- Story `3-5-universal-activity-tab.md` (`current_member_id()` — defined once there,
  reused here) and `6-2-row-level-scoping-for-a-single.md` (`current_member_role()`).
- `supabase/tests/references_entity.sql:1-60` (SQL test-suite shape to copy).

### Project Structure Notes

- New schema objects go in the existing files (`01_tables.sql`, `02_functions.sql`,
  `04_triggers.sql`, `05_policies.sql`, `06_grants.sql`) — no new schema file; this
  matches how every prior resource (`shidduchim`, `reference_links`, `tasks`) was
  added.
- New UI resource directory: `src/components/atomic-crm/threads/` — mirrors the
  one-folder-per-resource convention (`AGENTS.md#Directory-Structure`).
- No route/manifest change is required by this story alone (no standalone `/threads`
  list route yet, per Task 8).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
