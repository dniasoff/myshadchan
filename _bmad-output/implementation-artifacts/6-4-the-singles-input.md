# Story 6.4: The single's input

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a single,
I want to give my view on a suggestion I can see,
so that my opinion is part of the process, attributed to me, and visible to
my parent without needing a separate conversation channel.

## Position in Epic 6

**3rd of 5 to build.** Depends on **Story 6.3** having put `interactions`
into "deny the `single` role by default" — this story's entire job is to open
exactly one, narrow hole in that default. Building this story before 6.3
would mean writing an exception with no rule to except from, and risks the
exception accidentally being the *only* interactions behaviour a single ever
gets tested against (missing the "and nothing else" half of the requirement).
Precedes **Story 6.1** for the reason given in that story: 6.1 is what
produces a real single login, and this story's write path must already be
safe (scoped to the single's own visible suggestion, nothing else) before a
real single can reach it.

## Acceptance Criteria

1. **A single may add input on a suggestion they can see (Story 6.2's
   visibility rule), and on no other suggestion** — not a sibling's, not a
   `new`/`not_sure`/`for_sure_not`/`no` suggestion of their own, not a
   `private_parent`-visibility one. Attempting any of those fails at the
   database, not just in the UI.

2. **Input is attributed to the single who wrote it, with a timestamp, and
   the attribution is server-set — never client-supplied.** The row's actor
   cannot be forged as a parent, a sibling, or anyone else, even by a raw
   `dataProvider.create()` call bypassing the intended form.

3. **The single can read back their own past input on a suggestion they can
   see, and no other single's, parent's, or shadchan's interaction content**
   — this is a narrow carve-out into Story 6.3's default deny, not a reversal
   of it.

4. **The input appears in the parent's right rail on that suggestion**,
   attributed and timestamped, using whatever read path the parent's
   suggestion 360 already uses for its `interactions` timeline (Epic 5 Story
   5.7 — "the rail shows the single's input"). No new parent-facing table or
   endpoint is introduced; the parent already has full `interactions` read
   access via the existing account-scoped policy (untouched by this story).

5. **Negative test, required by `.claude/rules/security-triggers.md`:** a
   single cannot insert a `kind` other than `single_input`; a single cannot
   insert against a suggestion outside their own visible set; a single
   cannot set `actor_member_id` to someone else's id; a single reading
   `interactions` never sees a `note`/`call_logged`/`status_change` row, only
   their own `single_input` rows.

## Tasks / Subtasks

- [ ] **Task 1 — Reuse check** (AC: all)
  - [ ] `grep -rniE "single_input|candidate_input|child_input" supabase/schemas/*.sql src/components/atomic-crm/` — confirm no earlier draft of this concept exists under a different name before adding a new one. `LSP workspaceSymbol` for the same.
  - [ ] Confirm Epic 5 Story 5.7 has already declared a right-rail slot/section for "the single's input" (its own AC says "the rail shows the single's input"). If the read path it uses is not `public.interactions` filtered by `kind`, adapt this story's write shape to match whatever Epic 5 actually built rather than introducing a second data path for the same concept (AD-1's single-owner rule) — grep
    `src/components/atomic-crm/shidduchim/` for the right-rail component before writing Task 4.

- [ ] **Task 2 — Widen the `interactions.kind` enumeration** (AC: 1)
  - [ ] `supabase/schemas/01_tables.sql`: `interactions_kind_check` gains
        `'single_input'`:
        ```sql
        constraint interactions_kind_check check (
            kind in ('note', 'call_logged', 'status_change', 'merge', 'link_created', 'link_removed', 'single_input')
        )
        ```
  - [ ] No change to `interactions_scope_check` or `interactions_scope_link_check`
        — a `single_input` row is always `target_type = 'shidduch'`,
        `scope = 'shidduch'`, `reference_link_id null`, exactly the existing
        "an interaction ABOUT a shidduch always has that shidduch as its
        parent" shape those constraints already enforce. Confirm this by
        reading both constraints before editing anything else in this table.

- [ ] **Task 3 — The narrow single-role policy on `interactions`** (AC: 1, 2, 3)
  - [ ] Add one policy, additive to Story 6.3's default deny (which stays
        untouched):
        ```sql
        create policy "Single may give and read their own input" on public.interactions
            for all to authenticated
            using (
                account_id = public.current_context_id()
                and public.current_member_role() = 'single'
                and kind = 'single_input'
                and actor_member_id = public.current_member_id()
            )
            with check (
                account_id = public.current_context_id()
                and public.current_member_role() = 'single'
                and kind = 'single_input'
                and actor_member_id = public.current_member_id()
                and target_type = 'shidduch'
                and scope = 'shidduch'
                and exists (
                    select 1
                    from public.shidduchim s
                        join public.singles c on c.id = s.single_id
                    where s.id = interactions.target_id
                      and s.visibility = 'shared'
                      and public.is_single_visible_state(s.pipeline_state)
                      and c.member_id = public.current_member_id()
                )
            );
        ```
        `for all` here is intentional and safe (unlike the tables in Story
        6.2/6.3, where `single` gets read-only): the `using`/`with check`
        clauses already pin every command to `kind = 'single_input' and
        actor_member_id = own id`, so a single can insert their own input and
        read it back, but the `with check`'s visibility join stops them from
        ever attaching it to a suggestion they cannot see — there is no
        additional command to further restrict. Update/delete on their own
        `single_input` row falls under the same clauses; if the product
        intent is "input is append-only, cannot be edited," change `for all`
        to `for select, insert` — decide this before implementing (see Dev
        Notes "Editable or append-only — decided here").

- [ ] **Task 4 — Server-set attribution defaults** (AC: 2)
  - [ ] `supabase/schemas/04_triggers.sql` + `02_functions.sql`: add
        `set_single_input_actor()`, a `before insert` trigger on
        `public.interactions`, `when (new.kind = 'single_input')`, mirroring
        the existing `set_account_id_default()` shape:
        ```sql
        CREATE OR REPLACE FUNCTION "public"."set_single_input_actor"() RETURNS "trigger"
            LANGUAGE "plpgsql"
            SET "search_path" TO ''
            AS $$
        begin
          new.actor_member_id := public.current_member_id();
          return new;
        end;
        $$;
        ```
        This means the client never needs to know its own `account_members.id`
        to submit input, and the `WITH CHECK`'s `actor_member_id = own id`
        clause in Task 3 becomes unforgeable by construction rather than by
        client discipline — a raw `dataProvider.create()` payload that tries
        to set `actor_member_id` to another id is silently overwritten before
        the check even runs.

- [ ] **Task 5 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_input_kind`
  - [ ] The check-constraint widening will diff as `DROP CONSTRAINT` +
        `ADD CONSTRAINT` — confirm the generated form does not also touch
        `interactions_scope_check`/`interactions_scope_link_check` (it should
        not, since neither is edited); if it regenerates all three, keep only
        the one this story actually changed and drop the redundant statements.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 6 — Frontend: the single's input form** (AC: 1, 2, 4)
  - [ ] Add the write side of whatever right-rail slot Epic 5 Story 5.7
        declared (Task 1's grep result). At minimum: a text input + submit,
        visible only when the viewer's resolved permission level is
        `single` **and** the suggestion is in their own visible set (the
        client-side gate is a UX nicety — Task 3's RLS is the actual
        boundary, per AD-1; do not treat the UI gate as sufficient on its
        own). Calls `dataProvider.create("interactions", { data: { target_type:
        "shidduch", target_id: shidduchId, scope: "shidduch", kind:
        "single_input", body } })` — no new custom RPC needed; the RLS
        `WITH CHECK` in Task 3 does all the validation a bespoke function
        would otherwise do.
  - [ ] Mirror in `providers/fakerest/`: extend the FakeRest `interactions`
        emulation (or wherever the fake data provider currently branches on
        `kind`) to accept `single_input` and to reject it for a non-`single`
        fake session, keeping AD-10's "both providers stay in sync." Grep
        `src/components/atomic-crm/providers/fakerest/` for the current
        `interactions` handling before adding a parallel branch.

- [ ] **Task 7 — Tests** (AC: 5)
  - [ ] New `supabase/tests/single_input.sql` + `.test.ts`. Arrange: one
        household, one `parent_admin`, one `single` linked to a `look_into`+
        `shared` suggestion, one `new` suggestion (same single, should be
        unwritable), one sibling `single` with her own visible suggestion.
  - [ ] Assert: as the single, inserting `kind = 'single_input'` on their own
        visible suggestion succeeds, `actor_member_id` in the returned row
        equals `current_member_id()` regardless of what the insert payload
        claimed for that column.
  - [ ] Assert: as the single, inserting on the `new` suggestion raises
        (RLS violation); inserting on the sibling's suggestion raises;
        inserting `kind = 'note'` raises even on their own visible suggestion.
  - [ ] Assert: as the single, `select * from public.interactions` returns
        only their own `single_input` row(s) — not the sibling's
        `single_input`, not any `note`/`call_logged`/`status_change` row a
        `parent_admin` seeded in arrange.
  - [ ] Assert: as the `parent_admin`, the single's `single_input` row is
        visible via the existing (untouched) account-scoped policy, with the
        correct `actor_member_id`/`created_at`.
  - [ ] Frontend: a component/unit test for the right-rail input form
        (render, submit, optimistic/refetch behaviour) per
        `.claude/rules/testing.md`'s AAA pattern and ≥80% coverage on the new
        file(s).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Editable or append-only — decided here

The epic's AC only says "I want to give my view... it appears... attributed
to me with a timestamp" — it does not say whether the single may later edit
or retract that input. Deciding it now rather than leaving it open: **input
is append-only** (insert + read only; no update, no delete) for the `single`
role, matching the audit-trail spirit of the rest of the `interactions`
timeline (nothing else in this table is user-editable after the fact either
— `call_logged`/`status_change`/etc. are all write-once). If a later story
wants "edit my own input," that is a new decision with its own AC, not a
silent widening here. **Task 3's policy must therefore use `for select,
insert` to `authenticated`, not `for all`** — the snippet in Task 3 shows
`for all` with a caveat precisely because this decision has to be made
before implementation, not deferred to the developer's judgement call.

### Why no new RPC, unlike `create_shidduch()`

`create_shidduch()` exists as a dedicated function because its validation
(initial-state legality, cross-account child/shadchan checks, provenance
defaults) cannot be expressed as a static `WITH CHECK` boolean — it needs
control flow and exception raising. A `single_input` insert needs none of
that: "this exact suggestion, in my own visible set, with my own actor id"
is a single boolean expression, which is exactly what `WITH CHECK` is for.
Adding a function here would be scope creep against KISS
(`.claude/rules/coding-style.md`) — the trigger in Task 4 plus the policy in
Task 3 is the whole mechanism.

### What this story does not decide

- **Whether a parent can reply to the single's input inline** (a
  conversation, as opposed to one-way input reaching the rail) — that is
  Epic 7's structured-thread model (FR94-99), not this story's. A
  `single_input` row is a fact recorded against the suggestion, not a
  thread.
- **Notifying the parent when new input arrives** — Epic 7 Story 7.5's
  notification surface, not this one.

### Testing standard

Same shape as Stories 6.2/6.3 for the SQL half. New frontend behaviour
(Task 6) gets a Vitest component test under `.claude/rules/testing.md`'s AAA
convention, colocated with the component per this repo's existing pattern
(e.g. `ShidduchCatchPanel.test.tsx` beside `ShidduchCatchPanel.tsx`).

### Project Structure Notes

- `supabase/schemas/01_tables.sql`, `04_triggers.sql`, `02_functions.sql`,
  `05_policies.sql` — schema edits.
- `supabase/migrations/<timestamp>_single_input_kind.sql` — generated +
  hand-checked.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — single-owner rule: one INSERT path's
  worth of validation per behaviour, expressed here as one `WITH CHECK`.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — dignity floor: "the child always
  sees their live prospects and can give input" — the un-lowerable floor this
  story implements the write half of (Story 6.2/6.3 implement the read half).
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "their input
  reaches the parent against the suggestion."
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.7] — the parent's
  right rail already declares a "single's input" slot; this story is the
  write path that fills it and the dependency this story's Task 1 checks for.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.4] — literal AC
  text.
- Current schema: `supabase/schemas/01_tables.sql` (`interactions` and its
  three check constraints — `interactions_kind_check`,
  `interactions_scope_check`, `interactions_scope_link_check` — all three
  must be read together before touching any one of them, since they are
  designed as a jointly-exhaustive set per the table's own comment),
  `supabase/schemas/02_functions.sql` (`set_account_id_default()`, the
  pattern `set_single_input_actor()` mirrors).
- `supabase/tests/single_input.sql`, `.test.ts` — new.
- Frontend: the right-rail input component lives wherever Epic 5 Story 5.7
  put the suggestion 360's right rail (expected under
  `src/components/atomic-crm/shidduchim/`, not a new top-level directory —
  confirm via Task 1's grep rather than guessing a path).
- `src/components/atomic-crm/providers/fakerest/` — FakeRest mirror per
  AD-10.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
