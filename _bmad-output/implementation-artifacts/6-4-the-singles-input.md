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
would mean writing an exception with no rule to except from. Precedes **Story
6.1**: 6.1 produces a real single login, and this story's write path must
already be safe before a real single can reach it.

**What already exists when this story starts** (verify, do not rebuild):
Story 5.7 added `'single_input'` to `interactions_kind_check` and to
`types.ts`'s `InteractionKind`, and built the read-side rail panel
(`shidduchim/ShidduchRightRail.tsx`, querying `interactions` filtered to
`kind = 'single_input'`). Story 3.5 added `current_member_id()` and the
`set_interaction_actor_member_id` before-insert trigger that server-sets
`actor_member_id` on **every** `interactions` insert and withheld the column
from the authenticated insert grant. This story adds only: the RLS carve-out,
the everyone-else immutability clause, the write-side form, and the
`useViewerRole()` rewiring that makes a `single` viewer representable in the
frontend at all.

## Acceptance Criteria

1. **A single may add input on a suggestion they can see (Story 6.2's
   visibility rule), and on no other suggestion** — not a sibling's, not a
   `new`/`not_sure`/`for_sure_not`/`no` suggestion of their own, not a
   `private_parent`-visibility one. Attempting any of those fails at the
   database, not just in the UI.

2. **Input is attributed to the single who wrote it, with a timestamp, and
   the attribution can be neither forged nor altered — by anyone.**
   Server-set on insert by 3.5's existing `set_interaction_actor_member_id`
   trigger (no new trigger in this story). Append-only after that: no role —
   the author included, the parent included — can update a `single_input`
   row, and `DELETE` on `interactions` is already revoked table-wide (audit
   trail, `06_grants.sql`). A parent editing the single's words would be
   forging their voice; see Dev Notes "Editable or append-only — decided".

3. **The single can read back their own past input, and no other
   interaction content** — not a sibling's `single_input`, not any
   `note`/`call_logged`/`status_change` row. A narrow carve-out into Story
   6.3's default deny, not a reversal of it.

4. **The input appears in the parent's right rail on that suggestion**,
   attributed and timestamped, through Story 5.7's existing
   `ShidduchRightRail.tsx` panel and the untouched account-scoped
   `interactions` read policy. No new parent-facing table, endpoint or
   component.

5. **The frontend can tell the viewer is a single.**
   `entity360/useViewerRole.ts` — Story 3.4's explicitly provisional hook,
   which maps the legacy `administrator` boolean and can never return
   `"single"` — is rewired to resolve the real active-context role via the
   `current_member_role()` RPC (Story 6.2; already granted to
   `authenticated`). The provisional mapping is deleted, not kept as a
   fallback (NFR-14). This is what makes this story's form gate, and every
   tab `minVisibility` declaration that names `single` or `self_manager`
   (e.g. Story 5.5's Medical tab), actually work for real roles.

6. **Negative tests, required by `.claude/rules/security-triggers.md`:** a
   single cannot insert a `kind` other than `single_input`; a single cannot
   insert against a suggestion outside their own visible set; a forged
   `actor_member_id` never lands (3.5 withholds the column from the insert
   grant and its trigger overwrites — either refusal satisfies the test, a
   stored forged id fails it); a single
   cannot update their own `single_input` row; a `parent_admin` cannot
   insert or update a `single_input` row; a single reading `interactions`
   sees only their own `single_input` rows.

## Tasks / Subtasks

- [ ] **Task 1 — Verify the landed prior work this story builds on** (AC: 2, 4)
  - [ ] `grep -n "single_input" supabase/schemas/01_tables.sql` — Story 5.7
        already widened `interactions_kind_check`. If absent, that is a 5.7
        regression to fix at its source, not a constraint for this story to
        add. Read `interactions_scope_check`/`interactions_scope_link_check`
        as they stand post-3.5 and confirm a `single_input` row fits the
        existing `target_type = 'shidduch'`, `scope = 'shidduch'`,
        `reference_link_id null` branch — no constraint change expected.
  - [ ] `grep -n "set_interaction_actor_member_id" supabase/schemas/04_triggers.sql`
        — 3.5's attribution trigger fires on every insert; this story adds
        no second one.
  - [ ] `grep -rn "single_input" src/components/atomic-crm/shidduchim/` —
        locate 5.7's rail panel; this story adds the write side to it.

- [ ] **Task 2 — The narrow single-role policies on `interactions`** (AC: 1, 2, 3)
  - [ ] Postgres policies take one command each (`FOR ALL` or one of
        `SELECT`/`INSERT`/...), so append-only means **two** policies,
        additive to 6.3's default deny (which stays untouched) —
        deliberately no `UPDATE` or `DELETE` policy for `single`:
        ```sql
        create policy "Single reads own input" on public.interactions
            for select to authenticated
            using (
                account_id = public.current_context_id()
                and public.current_member_role() = 'single'
                and kind = 'single_input'
                and actor_member_id = public.current_member_id()
            );

        create policy "Single adds input on a visible suggestion" on public.interactions
            for insert to authenticated
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
        The `actor_member_id = current_member_id()` clause is satisfied by
        construction (3.5's trigger runs before the check), and pins the
        policy against any future weakening of that trigger.
  - [ ] **Immutability for everyone else:** add `and kind <> 'single_input'`
        to the `with check` of every **other** policy on `interactions`
        (enumerate via `pg_policies`, as 6.3 did: the base account policy,
        plus 3.6's note-author clause if it landed as a separate policy).
        `with check` gates inserts and the post-image of updates, so this one
        clause stops any non-single path from creating a `single_input` row
        and stops anyone — parent included — from editing one. Reads are
        untouched (`using` unchanged), so the parent's rail keeps working.

- [ ] **Task 3 — Generate and hand-check the migration** (AC: 1, 2, 3)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_input_policies`
  - [ ] Expect `CREATE POLICY` × 2 and `ALTER POLICY` only — no constraint
        changes (Task 1 verified 5.7 owns the kind widening), no trigger
        changes.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 4 — `useViewerRole()` rewiring** (AC: 5)
  - [ ] Rewrite `entity360/useViewerRole.ts`: resolve the role from the
        `current_member_role()` RPC (thin dataProvider/supabase-client call,
        cached via TanStack Query — same pattern as 3.6's `useMyMemberId`),
        keeping the exported `Role | undefined` signature so no caller
        changes. Delete the `sales.administrator` mapping entirely.
  - [ ] Mirror in the FakeRest provider: the fake session exposes a role and
        the emulated RPC returns it (AD-10).
  - [ ] Decidable check: `grep -rn "\.administrator" src/components/atomic-crm/entity360/`
        returns zero hits (3.4's grep contract, now strengthened from
        "exactly one" to "none").

- [ ] **Task 5 — Frontend: the single's input form** (AC: 1, 4, 5)
  - [ ] Add the write side to 5.7's rail panel in
        `shidduchim/ShidduchRightRail.tsx` (or its extracted panel child): a
        text input + submit, rendered only when `useViewerRole() === "single"`
        (a UX nicety — Task 2's RLS is the boundary, per AD-1). Calls
        `dataProvider.create("interactions", { data: { target_type: "shidduch",
        target_id: shidduchId, scope: "shidduch", kind: "single_input", body } })`
        — no new custom RPC; the `WITH CHECK` does all the validation a
        bespoke function would (see Dev Notes "Why no new RPC").
  - [ ] FakeRest: extend the existing `interactions` structural-guarantee
        branch (`providers/fakerest/dataProvider.ts`, which already emulates
        the no-delete/no-rehome rules) to accept `single_input` inserts for a
        `single` fake session and reject them otherwise, and to reject
        updates to `single_input` rows (AD-10 parity with Task 2).

- [ ] **Task 6 — Tests** (AC: 6)
  - [ ] New `supabase/tests/single_input.sql` + `.test.ts`. Arrange: one
        household, one `parent_admin`, one `single` linked to a `look_into`+
        `shared` suggestion, one `new` suggestion (same single, unwritable),
        one sibling `single` with her own visible suggestion and one
        `single_input` row on it.
  - [ ] Assert: as the single, inserting `kind = 'single_input'` on their own
        visible suggestion (without naming `actor_member_id`) succeeds and
        stores their own membership id; an insert payload naming someone
        else's `actor_member_id` either raises (column withheld from the
        insert grant) or stores the caller's own id — assert no row ever
        carries the forged id.
  - [ ] Assert: as the single, inserting on the `new` suggestion raises;
        inserting on the sibling's suggestion raises; inserting
        `kind = 'note'` raises even on their own visible suggestion;
        `update ... set body` on their own `single_input` row affects zero
        rows.
  - [ ] Assert: as the `parent_admin`, the single's `single_input` row is
        readable with correct `actor_member_id`/`created_at`; inserting a
        `single_input` row raises; updating the single's row affects zero
        rows.
  - [ ] Assert: as the single, `select * from public.interactions` returns
        only their own `single_input` row(s) — not the sibling's, not the
        parent-seeded `note`/`status_change` rows.
  - [ ] Frontend: component test for the input form (renders only for a
        `single` viewer, submit calls create with the fixed shape) and a
        `useViewerRole` unit test (RPC value passed through; no
        `administrator` read), AAA per `.claude/rules/testing.md`, ≥80%
        coverage on new/changed files.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Editable or append-only — decided

The epic's AC only says "I want to give my view... it appears... attributed
to me with a timestamp" — it does not say whether the input may later be
edited or retracted. Decided: **append-only, for everyone.** Nothing else in
`interactions` is editable after the fact except a note's own body, and a
`single_input` row is testimony in the family's record — a parent able to
edit it could put words in the single's mouth, which breaks "attributed to
me" more subtly than forging the actor id would. Task 2 implements this as
the absence of an `UPDATE` policy for `single` plus `kind <> 'single_input'`
in every other policy's `with check`; `DELETE` was already revoked
table-wide. If a later story wants "edit my own input," that is a new
decision with its own AC, not a silent widening here.

### Why no new RPC, and no new trigger

`create_shidduch()` exists as a function because its validation needs control
flow. A `single_input` insert needs none: "this exact suggestion, in my own
visible set, with my own actor id" is one boolean expression — exactly what
`WITH CHECK` is for. And attribution is already server-set by 3.5's
`set_interaction_actor_member_id`, which fires on every `interactions`
insert; an earlier draft of this story added a second, `single_input`-only
actor trigger, which would have been a duplicate writer of the same column
(the single-owner rule forbids it). This story is two policies, one clause,
one form.

### What this story does not decide

- **Whether a parent can reply to the single's input inline** — Epic 7's
  structured-thread model (FR94-99). A `single_input` row is a fact recorded
  against the suggestion, not a thread.
- **Notifying the parent when new input arrives** — Epic 7 Story 7.5.

### Testing standard

Same shape as Stories 6.2/6.3 for the SQL half. Frontend behaviour gets
Vitest component tests colocated with the component (e.g.
`ShidduchCatchPanel.test.tsx` beside `ShidduchCatchPanel.tsx` is the existing
pattern).

### Project Structure Notes

- `supabase/schemas/05_policies.sql` — the only schema file this story edits.
- `supabase/migrations/<timestamp>_single_input_policies.sql` — generated +
  hand-checked.
- `src/components/atomic-crm/entity360/useViewerRole.ts` — rewired (Task 4).
- `src/components/atomic-crm/shidduchim/ShidduchRightRail.tsx` (and/or its
  panel child from 5.7) — gains the write side.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — extends
  the existing `interactions` emulation branch.
- `supabase/tests/single_input.sql`, `.test.ts` — new.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — single-owner rule: one INSERT path's
  worth of validation per behaviour, expressed here as one `WITH CHECK`.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — dignity floor: "the child always
  sees their live prospects and can give input" — this story is the write
  half (6.2/6.3 are the read half).
- [Source: ARCHITECTURE-SPINE.md#AD-24] — tabs declare a minimum visibility;
  Task 4 is what makes that resolvable for `single`/`self_manager` viewers.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "their input
  reaches the parent against the suggestion."
- [Source: _bmad-output/implementation-artifacts/5-7-shidduch-right-rail.md]
  — owns the `interactions_kind_check` widening and the read-side rail panel.
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md]
  — owns `current_member_id()` and the `set_interaction_actor_member_id`
  trigger this story relies on.
- [Source: _bmad-output/implementation-artifacts/3-4-permission-aware-rendering.md]
  — the provisional `useViewerRole()` Task 4 replaces, and its grep contract.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.4] — literal AC
  text.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
