# Story 6.4: The single's input

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a single,
I want to give my view on a suggestion I can see,
so that my opinion is part of the process, attributed to me, and visible to
my parent without needing a separate conversation channel.

## Position in Epic 6

**4th of 6 to build.** Depends on **Story 6.3** having put `interactions`
into "deny the `single` role by default" — this story's entire job is to open
exactly one, narrow hole in that default. Building it before 6.3 would mean
writing an exception with no rule to except from. Precedes **Story 6.1**: 6.1
produces a real single login, and this story's write path must already be
safe before a real single can reach it.

**Binding delivery order: 6.6 → 6.2 → 6.3 → 6.4 → 6.1 → 6.5.**

**What already exists at HEAD — verify, do not rebuild.** This section was
re-checked against the tree for this refresh, and it is much larger than
earlier drafts assumed:

- **`'single_input'` is a live `interactions.kind`.** `interactions_kind_check`
  (`01_tables.sql:644-646`) admits it; `InteractionKind` in `types.ts:603-610`
  includes it; `entity360/tabs/interactionLabels.ts:66` gives it a label key,
  present in both i18n catalogues. Story 5.7 landed all of it.
- **The read side is built.** `shidduchim/SingleInputPanel.tsx` renders a
  newest-first feed of `kind = 'single_input'` rows filtered to the shidduch
  and `deleted_at is null`; `shidduchim/ShidduchRightRail.tsx` mounts it
  under "The single's input" heading. AC-4 is therefore **already satisfied
  by shipped code** once a row exists — this story writes rows, it does not
  build the parent's view.
- **Attribution is already server-set.** `set_interaction_actor_member_id`
  (`02_functions.sql:417`, wired in `04_triggers.sql`) fires before insert on
  every `interactions` row, and `06_grants.sql:705-706` revokes UPDATE
  table-wide and re-grants it on `(body, metadata, deleted_at)` only, so
  `actor_member_id` is not client-writable at all. This story adds **no
  trigger**.
- **The viewer's role already resolves to `"single"`.** `entity360/useViewerRole.ts`
  reads `my_contexts()` through `root/useMyContexts.ts` and
  `providers/commons/roleAuthority.ts`'s `pickActiveRole`, returning the real
  `MemberRole` of the active context. It has **no** `members.administrator`
  mapping — `entity360/roleSource.guard.test.ts` proves that flag, plus
  `useGetIdentity` and the retired name `minVisibility`, appear nowhere under
  `entity360/`. Any story text describing `useViewerRole` as "provisional",
  as "mapping the legacy administrator boolean", or as needing to be rewired
  onto a `current_member_role()` RPC is describing Story 3.4's *draft*, not
  what shipped. **There is no `useViewerRole` work in this story.**
- **The UPDATE policy already restricts `single_input`.** 5.7's review-fix
  pass added `single_input` to the moderation bucket, so the UPDATE policy's
  tail reads `kind not in ('note', 'single_input') or
  public.can_moderate_note(actor_member_id)` (`05_policies.sql:514`+).
  Task 2 narrows that further; see Dev Notes "Append-only — decided, against
  a shipped nuance".

This story adds exactly: the RLS carve-out, the everyone-else immutability
clause, and the write-side form.

## Acceptance Criteria

1. **A single may add input on a suggestion they can see (Story 6.2's
   visibility rule), and on no other suggestion** — not a sibling's, not a
   `new`/`not_sure`/`for_sure_not`/`no` suggestion of their own, not a
   `private_parent`- or `private_single`-visibility one. Attempting any of
   those fails at the database, not just in the UI.

2. **Input is attributed to the single who wrote it, with a timestamp, and
   the attribution can be neither forged nor altered.** Attribution is
   server-set by the existing `set_interaction_actor_member_id` trigger and
   the column is withheld from the client's UPDATE grant. `DELETE` on
   `interactions` is already revoked table-wide.

3. **A `single_input` row is append-only for every role, including its
   author and including a `parent_admin`.** No `UPDATE` policy admits
   `kind = 'single_input'` after this story — not the single's own
   (they cannot revise their words after submitting), and not an owning
   role's (a parent editing the single's words would be forging their
   voice). This **narrows** the moderation capability 5.7's review fix
   granted; the narrowing is deliberate and is argued in Dev Notes, not
   incidental.

4. **The single can read back their own past input, and no other
   interaction content** — not a sibling's `single_input`, not any
   `note`/`call_logged`/`status_change`/`merge`/`link_created`/`link_removed`
   row. A narrow carve-out into Story 6.3's default deny, not a reversal of
   it.

5. **The input appears in the parent's right rail on that suggestion**,
   attributed and timestamped, through the shipped `SingleInputPanel.tsx`
   and the untouched account-scoped `interactions` read policy. No new
   parent-facing table, endpoint or component, and **no change to
   `ShidduchRightRail.tsx` or `SingleInputPanel.tsx`**.

6. **The single's write surface is a tab region, not the right rail.**
   Ruling 2 (contract §11) makes the rail a read-only summary, and
   `shidduchim/ShidduchRightRail.guard.test.ts` enforces it mechanically:
   it scans `ShidduchRightRail.tsx`, `SingleInputPanel.tsx` and
   `ForwardResumeButton.tsx` for `useCreate`/`useUpdate`/`useDelete`/
   `useMutation` and for `Input`/`Textarea`/`Checkbox`, and fails on any hit.
   The form therefore lives in a new `shidduchim/SingleInputForm.tsx` mounted
   inside `ShidduchOverviewTab.tsx` — an existing canonical tab that a single
   can reach (Story 6.2 grants the row; Story 6.3 leaves `overview`
   unrestricted) and that already hosts a mutation surface
   (`ShidduchCatchSection`). No new `TabKey`, no `CANONICAL_TAB_SETS`
   amendment, no `Entity360` region added.

7. **Negative tests, required by `.claude/rules/security-triggers.md`:** a
   single cannot insert a `kind` other than `single_input`; a single cannot
   insert against a suggestion outside their own visible set; a forged
   `actor_member_id` never lands (the column is withheld from the insert
   grant and the trigger overwrites — either refusal satisfies the test, a
   stored forged id fails it); a single cannot update their own
   `single_input` row; a `parent_admin` can neither insert nor update a
   `single_input` row; a single reading `interactions` sees only their own
   `single_input` rows.

## Tasks / Subtasks

- [ ] **Task 1 — Verify the landed prior work this story builds on** (AC: 2, 5)
  - [ ] `grep -n "single_input" supabase/schemas/01_tables.sql` — 5.7 already
        widened `interactions_kind_check`. If absent, that is a 5.7
        regression to fix at its source, not a constraint for this story to
        add. Read `interactions_scope_check`/`interactions_scope_link_check`
        (`01_tables.sql:647-668`) and confirm a `single_input` row fits the
        existing `target_type = 'shidduch'` / `scope = 'shidduch'` /
        `reference_link_id is null` branch — no constraint change expected.
  - [ ] `grep -n "set_interaction_actor_member_id" supabase/schemas/04_triggers.sql`
        — the attribution trigger fires on every insert; this story adds no
        second one.
  - [ ] Read `shidduchim/SingleInputPanel.tsx` and
        `shidduchim/ShidduchRightRail.guard.test.ts` before writing any
        frontend code, so the read/write split in AC-6 is concrete rather
        than remembered.

- [ ] **Task 2 — The narrow single-role policies on `interactions`** (AC: 1, 3, 4)
  - [ ] Postgres policies take one command each, so append-only means
        **two** new policies, additive to 6.3's default deny (which stays
        untouched) — deliberately no `UPDATE` or `DELETE` policy for
        `single`:
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
        construction (the trigger runs before the check) and pins the policy
        against any future weakening of that trigger.
  - [ ] **Immutability, in the `using` half as well as `with check`.** On the
        UPDATE policy `"Interactions updatable by author or owning role"`,
        change the tail clause in **both** `using` and `with check` from
        ```sql
        and (kind not in ('note', 'single_input') or public.can_moderate_note(actor_member_id))
        ```
        to
        ```sql
        and (kind not in ('note', 'single_input')
             or (kind = 'note' and public.can_moderate_note(actor_member_id)))
        ```
        so `kind = 'single_input'` satisfies neither branch and is denied to
        every role. `using` is what makes AC-7's observable a **zero-rows
        UPDATE** rather than a raised error; a `with check`-only edit would
        raise instead, and the tests below assert zero rows. Update the
        policy's long comment block, which currently explains why
        `single_input` joined the moderatable bucket — replace that
        paragraph rather than leaving it contradicting the code.
  - [ ] On the INSERT policy `"Interactions insertable within account and
        parent visibility"`, add `and kind <> 'single_input'` to its
        `with check`, so no non-single path can create one. (6.3 already
        added `and public.current_member_role() <> 'single'` to the same
        expression; both clauses stand.)
  - [ ] Leave the SELECT policy `"Interactions readable within account and
        parent visibility"` alone beyond 6.3's edit — the parent's rail reads
        through it and must keep working (AC-5).

- [ ] **Task 3 — Generate and hand-check the migration** (AC: 1, 3, 4)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_input_policies`
  - [ ] Expect `CREATE POLICY` × 2 plus `DROP POLICY`+`CREATE POLICY` (or
        `ALTER POLICY`) on the existing UPDATE and INSERT policies — no
        constraint changes (Task 1 verified 5.7 owns the kind widening), no
        trigger changes, no grant changes.
  - [ ] `make check-migration-safety`. Policies only; must pass with no new
        `declared-moves.sql` entry.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 4 — Frontend: the single's input form** (AC: 6)
  - [ ] New `src/components/atomic-crm/shidduchim/SingleInputForm.tsx`: a
        labelled textarea + submit, rendered only when
        `useViewerRole().role === "single"` (a UX gate — Task 2's RLS is the
        boundary, per AD-1) and nothing at all while `isPending`. It calls
        `dataProvider.create("interactions", { data: { target_type:
        "shidduch", target_id: shidduchId, scope: "shidduch", kind:
        "single_input", body } })` — no new custom RPC; the `WITH CHECK` does
        all the validation a bespoke function would (Dev Notes "Why no new
        RPC"). It never sends `actor_member_id` or `account_id`.
  - [ ] Mount it in `shidduchim/ShidduchOverviewTab.tsx`, above
        `ShidduchCatchSection`. Do **not** touch `ShidduchRightRail.tsx` or
        `SingleInputPanel.tsx` — `ShidduchRightRail.guard.test.ts` will fail
        the moment either imports a mutation hook or a form control, and that
        failure is the intended design constraint, not an obstacle to route
        around.
  - [ ] After a successful create, refetch the panel's list (invalidate the
        `interactions` list query) so the single sees their own submission
        immediately — their read policy grants it.
  - [ ] All strings through the `i18nProvider` (AD-18), keys added to **both**
        `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts`.
        Note `crm.entity360.rail.singleInput.*` keys already exist for the
        read side; the form's keys are new and belong under the shidduch
        overview namespace, not the rail one.
  - [ ] FakeRest parity (AD-10): extend the existing `interactions`
        structural-guarantee branch in
        `providers/fakerest/dataProvider.ts` (which already emulates the
        no-delete/no-rehome rules and, per
        `dataProvider.interactions.test.ts:197-216`, already accepts a
        `single_input` insert) so it accepts `single_input` **only** for a
        `single` fake session and rejects updates to `single_input` rows for
        everyone.

- [ ] **Task 5 — Tests** (AC: 7)
  - [ ] New `supabase/tests/single_input.sql` + `.test.ts`, reusing Story
        6.2's fixture helper from `dbSuiteHelpers.ts` where possible.
        Arrange: one household, one `parent_admin`, one `single` linked to a
        `look_into`+`shared` suggestion, one `new` suggestion (same single,
        unwritable), one sibling `single` with her own visible suggestion and
        one `single_input` row on it.
  - [ ] Assert: as the single, inserting `kind = 'single_input'` on their own
        visible suggestion (without naming `actor_member_id`) succeeds and
        stores their own membership id; an insert payload naming someone
        else's `actor_member_id` either raises (column withheld from the
        insert grant) or stores the caller's own id — assert no row ever
        carries the forged id.
  - [ ] Assert: as the single, inserting on the `new` suggestion raises;
        inserting on the sibling's suggestion raises; inserting
        `kind = 'note'` raises even on their own visible suggestion;
        `update ... set body` on their own `single_input` row affects **zero
        rows** (not raises — this is what the `using`-half edit in Task 2
        buys); `update ... set deleted_at = now()` on it likewise affects
        zero rows.
  - [ ] Assert: as the `parent_admin`, the single's `single_input` row is
        readable with the correct `actor_member_id`/`created_at`; inserting a
        `single_input` row raises; updating the single's row affects zero
        rows; soft-deleting it affects zero rows.
  - [ ] Assert: as the `parent_admin`, updating a `kind = 'note'` row they
        authored still works — the moderation path for notes is untouched by
        this story, and a test proving it is what stops Task 2's clause edit
        from over-reaching.
  - [ ] Assert: as the single, `select * from public.interactions` returns
        only their own `single_input` row(s) — not the sibling's, not the
        parent-seeded `note`/`status_change` rows — and
        `public.interactions_summary` returns the same set.
  - [ ] Regression: `interaction_note_authorship.sql`,
        `interactions_targets.sql`, `single_row_scoping.sql`,
        `single_field_scoping.sql` all pass **unmodified**.
  - [ ] Frontend: component test for `SingleInputForm` (renders only for a
        `single` viewer, renders nothing while `isPending`, submit calls
        `create` with the exact fixed shape and never sends
        `actor_member_id`), plus an assertion that `ShidduchOverviewTab`
        mounts it. `vitest-browser-react` + `TestMemoryRouter`; React Testing
        Library is not a dependency. ≥80% coverage on new/changed files.
  - [ ] `ShidduchRightRail.guard.test.ts` must pass **unmodified** — it is
        the mechanical statement of AC-6.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Append-only — decided, against a shipped nuance

The epic's AC only says "I want to give my view... it appears... attributed
to me with a timestamp" — it does not say whether the input may later be
edited or retracted. Decided: **append-only, for everyone.**

This is a deliberate narrowing of something that shipped. Story 5.7's review
fix (finding F2) added `single_input` to the `can_moderate_note()` bucket so
that a *helper* could not rewrite a single's words, which left the author and
the owning roles able to edit and to soft-delete such a row. That fix's
intent — nobody puts words in the single's mouth — is served more completely
by denying UPDATE outright, so this story goes the rest of the way rather
than preserving a capability the epic never asked for.

The cost is named, not hidden: **there is no retraction path** for a
`single_input` row after this story. If the product later wants one, it is a
new decision with its own AC and its own write path (a `retracted_at` column
with a narrow policy, or an owning-role `deleted_at`-only grant), not a
silent re-widening of this clause. What must not happen is a future story
re-adding `single_input` to the moderatable bucket without re-deciding it —
AC-3 and its zero-rows tests exist to make that impossible to do quietly.

### Why no new RPC, and no new trigger

`create_shidduch()` exists as a function because its validation needs control
flow. A `single_input` insert needs none: "this exact suggestion, in my own
visible set, with my own actor id" is one boolean expression — exactly what
`WITH CHECK` is for. And attribution is already server-set by
`set_interaction_actor_member_id`, which fires on every `interactions`
insert; an earlier draft of this story added a second, `single_input`-only
actor trigger, which would have been a duplicate writer of the same column
(the single-owner rule forbids it). This story is two policies, two clause
edits, and one form.

### Why the form is not in the right rail

The right rail is a read-only summary region by ruling (contract §11 Ruling
2) and by test (`ShidduchRightRail.guard.test.ts` scans all three rail
sources for mutation hooks and form controls). Putting a textarea there would
fail CI, and rewriting the guard to permit it would delete the ruling rather
than implement the story. The Overview tab is the right host: it is the one
canonical tab a single can reach in full, it already carries a mutation
surface, and the read/write split (write on the tab, read on the parent's
rail) matches how the two audiences actually use the screen.

### What this story does not decide

- **Whether a parent can reply to the single's input inline** — Epic 7's
  structured-thread model (FR94-99). A `single_input` row is a fact recorded
  against the suggestion, not a thread.
- **Notifying the parent when new input arrives** — Epic 7 Story 7.5.
- **Anything about `useViewerRole`** — it shipped in Story 3.4 reading
  `my_contexts()` and already returns `"single"`. This story consumes it.

### Testing standard

Same shape as Stories 6.2/6.3 for the SQL half — plain `results`-table
suites via `npm run test:unit:db`, identity via `set local
request.jwt.claims`, harness in `supabase/tests/dbSuiteHelpers.ts`. Frontend
behaviour gets Vitest component tests colocated with the component (e.g.
`ShidduchCatchPanel.test.tsx` beside `ShidduchCatchPanel.tsx` is the existing
pattern), run in real Chromium via `vitest-browser-react`.

### Project Structure Notes — the true file set

Schema / DB:
- `supabase/schemas/05_policies.sql` — the only schema file this story edits
  (two new policies, two clause edits, one comment block rewritten)
- `supabase/migrations/<timestamp>_single_input_policies.sql`
- `supabase/tests/single_input.sql`, `.test.ts` — new
- `supabase/tests/dbSuiteHelpers.ts` — if the shared fixture gains a case
- Regression-only, must not be edited: `interaction_note_authorship.sql`,
  `interactions_targets.sql`, `single_row_scoping.sql`,
  `single_field_scoping.sql`

Frontend:
- `src/components/atomic-crm/shidduchim/SingleInputForm.tsx` + `.test.tsx` (new)
- `src/components/atomic-crm/shidduchim/ShidduchOverviewTab.tsx` (mounts it)
- `src/components/atomic-crm/shidduchim/entityDescriptor.test.tsx` (the
  overview-tab assertion, if that is where tab content is asserted)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` +
  `dataProvider.interactions.test.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`,
  `frenchCrmMessages.ts`
- `registry.json` (regenerated by the pre-commit hook — a new file under
  `src/components/atomic-crm/` always changes it)
- Unchanged and guarded: `shidduchim/ShidduchRightRail.tsx`,
  `shidduchim/SingleInputPanel.tsx`,
  `shidduchim/ShidduchRightRail.guard.test.ts`,
  `entity360/useViewerRole.ts`, `entity360/roleSource.guard.test.ts`

E2E:
- `e2e/pipeline.spec.ts` / `e2e/fixtures.ts` — only if a single-role fixture
  session is added; not required by any AC here.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — single-owner rule: one INSERT path's
  worth of validation per behaviour, expressed here as one `WITH CHECK`.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — dignity floor: "the single always
  sees their live prospects and can give input" — this story is the write
  half (6.2/6.3 are the read half).
- [Source: ARCHITECTURE-SPINE.md#AD-24] — the spine words tab visibility as
  "tabs declare a minimum visibility"; the **implemented** mechanism is
  `EntityTabDescriptor.visibleTo?: MemberRole[]`, an allow-list. There is no
  `minVisibility`.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#11] —
  Ruling 2: the Tasks tab is canonical and the rail is a read-only summary;
  the basis for AC-6.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#6] — rule 1:
  `useViewerRole` is built on `my_contexts()`, not `members.administrator` —
  the rule this story's earlier draft mistook for outstanding work.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "their input
  reaches the parent against the suggestion."
- [Source: _bmad-output/implementation-artifacts/5-7-shidduch-right-rail.md]
  — owns the `interactions_kind_check` widening, `SingleInputPanel.tsx`, the
  rail guard, and the F2 moderation clause AC-3 narrows.
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md]
  — owns `current_member_id()` and the `set_interaction_actor_member_id`
  trigger this story relies on.
- [Source: _bmad-output/implementation-artifacts/3-4-permission-aware-rendering.md]
  — the shipped `useViewerRole()`/`hasVisibility()`/`canAccess.ts` seam this
  story consumes unchanged.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.4] — literal AC
  text.
- Current code, verified for this refresh:
  `supabase/schemas/01_tables.sql:644-668` (`interactions_kind_check`,
  `interactions_scope_link_check`); `supabase/schemas/02_functions.sql:417`
  (`set_interaction_actor_member_id`), `:608` (`can_moderate_note`);
  `supabase/schemas/05_policies.sql:383` / `:435` / `:514` (the three
  `interactions` policies); `supabase/schemas/06_grants.sql:679-680`,
  `:705-706`; `src/components/atomic-crm/entity360/useViewerRole.ts`;
  `src/components/atomic-crm/shidduchim/SingleInputPanel.tsx`;
  `src/components/atomic-crm/shidduchim/ShidduchRightRail.guard.test.ts`;
  `src/components/atomic-crm/types.ts:603-610`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
