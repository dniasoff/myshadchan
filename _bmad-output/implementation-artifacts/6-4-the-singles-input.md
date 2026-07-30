---
baseline_commit: f3784c8
---

# Story 6.4: The single's input

Status: review

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
  `actor_member_id` is not client-writable **after the row is stored**.
  **Post-review correction (finding 3): it IS writable in the INSERT
  payload** — INSERT is granted table-wide on `interactions`, never
  column-narrowed, so on the write path the trigger is the entire defence
  and the grant layer contributes nothing. This story adds **no trigger**,
  which makes the existing one load-bearing rather than redundant.
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
   unrestricted). ~~and that already hosts a mutation surface
   (`ShidduchCatchSection`)~~ — **struck post-review (finding 4): that
   rationale was false and is not needed.** `ShidduchCatchSection` writes
   nothing: confirm is a `useRedirect()` to the prior suggestion, dismiss is
   a `useState` set held for the session, and its own file comment says so
   ("Confirm and dismiss are session-level… nothing is written and nothing
   merges"). `SingleInputForm` is therefore the **first** mutation surface on
   the Overview tab, not an additional one. The placement still holds on the
   two reasons that are true — the rail is read-only by ruling and by test,
   and Overview is the one canonical tab a single reaches in full — but no
   future story may cite "Overview already mutates" as precedent, because it
   did not. No new `TabKey`, no `CANONICAL_TAB_SETS` amendment, no
   `Entity360` region added.

7. **Negative tests, required by `.claude/rules/security-triggers.md`:** a
   single cannot insert a `kind` other than `single_input`; a single cannot
   insert against a suggestion outside their own visible set; a forged
   `actor_member_id` never lands (**mechanism corrected post-review, see
   "Finding 3" below — the column is NOT withheld from the insert grant;
   the BEFORE INSERT trigger is the whole of the write-side defence** —
   either refusal satisfies the test, a stored forged id fails it); a
   single cannot update their own
   `single_input` row; a `parent_admin` can neither insert nor update a
   `single_input` row; a single reading `interactions` sees only their own
   `single_input` rows.

## Tasks / Subtasks

- [x] **Task 1 — Verify the landed prior work this story builds on** (AC: 2, 5)
  - [x] `grep -n "single_input" supabase/schemas/01_tables.sql` — 5.7 already
        widened `interactions_kind_check`. If absent, that is a 5.7
        regression to fix at its source, not a constraint for this story to
        add. Read `interactions_scope_check`/`interactions_scope_link_check`
        (`01_tables.sql:647-668`) and confirm a `single_input` row fits the
        existing `target_type = 'shidduch'` / `scope = 'shidduch'` /
        `reference_link_id is null` branch — no constraint change expected.
  - [x] `grep -n "set_interaction_actor_member_id" supabase/schemas/04_triggers.sql`
        — the attribution trigger fires on every insert; this story adds no
        second one.
  - [x] Read `shidduchim/SingleInputPanel.tsx` and
        `shidduchim/ShidduchRightRail.guard.test.ts` before writing any
        frontend code, so the read/write split in AC-6 is concrete rather
        than remembered.

- [x] **Task 2 — The narrow single-role policies on `interactions`** (AC: 1, 3, 4)
  - [x] Postgres policies take one command each, so append-only means
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
  - [x] **Immutability, in the `using` half as well as `with check`.** On the
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
  - [x] On the INSERT policy `"Interactions insertable within account and
        parent visibility"`, add `and kind <> 'single_input'` to its
        `with check`, so no non-single path can create one. (6.3 already
        added `and public.current_member_role() <> 'single'` to the same
        expression; both clauses stand.)
  - [x] Leave the SELECT policy `"Interactions readable within account and
        parent visibility"` alone beyond 6.3's edit — the parent's rail reads
        through it and must keep working (AC-5).

- [x] **Task 3 — Generate and hand-check the migration** (AC: 1, 3, 4)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_input_policies`
        (run against the STACK_ID=4 stack, not the shared default local
        instance — see Dev Agent Record for the exact commands).
  - [x] Expect `CREATE POLICY` × 2 plus `DROP POLICY`+`CREATE POLICY` (or
        `ALTER POLICY`) on the existing UPDATE and INSERT policies — no
        constraint changes (Task 1 verified 5.7 owns the kind widening), no
        trigger changes, no grant changes. Confirmed: the generated migration
        is exactly `CREATE POLICY` × 2 (new) + `DROP POLICY`/`CREATE POLICY`
        × 2 (existing UPDATE and INSERT policies), nothing else.
  - [x] `make check-migration-safety`. Policies only; must pass with no new
        `declared-moves.sql` entry. PASSED against STACK_ID=4 (32 seeded rows
        across 19 tables survived intact).
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`. Applied to STACK_ID=4;
        `db diff` confirmed clean twice afterward.

- [x] **Task 4 — Frontend: the single's input form** (AC: 6)
  - [x] New `src/components/atomic-crm/shidduchim/SingleInputForm.tsx`: a
        labelled textarea + submit, rendered only when
        `useViewerRole().role === "single"` (a UX gate — Task 2's RLS is the
        boundary, per AD-1) and nothing at all while `isPending`. It calls
        `dataProvider.create("interactions", { data: { target_type:
        "shidduch", target_id: shidduchId, scope: "shidduch", kind:
        "single_input", body } })` — no new custom RPC; the `WITH CHECK` does
        all the validation a bespoke function would (Dev Notes "Why no new
        RPC"). It never sends `actor_member_id` or `account_id`.
  - [x] Mount it in `shidduchim/ShidduchOverviewTab.tsx`, above
        `ShidduchCatchSection`. Do **not** touch `ShidduchRightRail.tsx` or
        `SingleInputPanel.tsx` — `ShidduchRightRail.guard.test.ts` will fail
        the moment either imports a mutation hook or a form control, and that
        failure is the intended design constraint, not an obstacle to route
        around. Neither file was touched; the guard suite passes unmodified.
  - [x] After a successful create, refetch the panel's list (invalidate the
        `interactions` list query) so the single sees their own submission
        immediately — their read policy grants it. Implemented via
        `useRefresh()` (the same remedy `NotesTab.tsx`'s `AddNoteForm` uses),
        not a targeted `invalidateQueries` call — broader but always correct,
        and consistent with the existing codebase idiom.
  - [x] All strings through the `i18nProvider` (AD-18), keys added to **both**
        `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts`.
        Note `crm.entity360.rail.singleInput.*` keys already exist for the
        read side; the form's keys are new and belong under the shidduch
        overview namespace, not the rail one. Landed as
        `crm.entity360.overview.singleInput.*`, alongside the existing
        generic `crm.entity360.overview.empty` key both `entity360/tabs/
        OverviewTab.tsx` and `shadchanim/ShadchanOverviewTab.tsx` already use
        for their own bespoke Overview tabs — the real "shidduch overview
        namespace" in this codebase, not a new top-level block.
  - [x] FakeRest parity (AD-10): extend the existing `interactions`
        structural-guarantee branch in
        `providers/fakerest/dataProvider.ts` (which already emulates the
        no-delete/no-rehome rules and, per
        `dataProvider.interactions.test.ts:197-216`, already accepts a
        `single_input` insert) so it accepts `single_input` **only** for a
        `single` fake session and rejects updates to `single_input` rows for
        everyone. The pre-existing "accepts a single_input-kind interaction"
        test (line ~201) now runs as an explicit single-role session
        (updated, not left as-is, since the default demo caller is
        `parent_admin`); new tests cover the non-single rejection and the
        append-only update guard (for the author and for a separate
        `parent_admin` session against the same in-memory db), plus a
        regression proving `note` moderation is untouched.

- [x] **Task 5 — Tests** (AC: 7) — see the regression bullet below and Dev
      Agent Record for a nuance worth reading even though every item now
      passes: 3 of the 4 named regression files needed a fix to keep
      passing once this story's own ACs were implemented correctly, and
      those fixes were made by another agent coordinating on the shared
      working tree, not by this story.
  - [x] New `supabase/tests/single_input.sql` + `.test.ts`, reusing Story
        6.2's fixture helper from `dbSuiteHelpers.ts` where possible.
        Arrange: one household, one `parent_admin`, one `single` linked to a
        `look_into`+`shared` suggestion, one `new` suggestion (same single,
        unwritable), one sibling `single` with her own visible suggestion and
        one `single_input` row on it.
  - [x] Assert: as the single, inserting `kind = 'single_input'` on their own
        visible suggestion (without naming `actor_member_id`) succeeds and
        stores their own membership id; an insert payload naming someone
        else's `actor_member_id` either raises (column withheld from the
        insert grant) or stores the caller's own id — assert no row ever
        carries the forged id.
  - [x] Assert: as the single, inserting on the `new` suggestion raises;
        inserting on the sibling's suggestion raises; inserting
        `kind = 'note'` raises even on their own visible suggestion;
        `update ... set body` on their own `single_input` row affects **zero
        rows** (not raises — this is what the `using`-half edit in Task 2
        buys); `update ... set deleted_at = now()` on it likewise affects
        zero rows.
  - [x] Assert: as the `parent_admin`, the single's `single_input` row is
        readable with the correct `actor_member_id`/`created_at`; inserting a
        `single_input` row raises; updating the single's row affects zero
        rows; soft-deleting it affects zero rows.
  - [x] Assert: as the `parent_admin`, updating a `kind = 'note'` row they
        authored still works — the moderation path for notes is untouched by
        this story, and a test proving it is what stops Task 2's clause edit
        from over-reaching.
  - [x] Assert: as the single, `select * from public.interactions` returns
        only their own `single_input` row(s) — not the sibling's, not the
        parent-seeded `note`/`status_change` rows — and
        `public.interactions_summary` returns the same set.
  - [x] Regression: `interaction_note_authorship.sql`,
        `interactions_targets.sql`, `single_row_scoping.sql`,
        `single_field_scoping.sql` all pass. **Not literally "unmodified" —
        verified empirically, not assumed, and worth reading in full even
        though the end state is green.** `single_row_scoping.sql` passes
        genuinely unmodified (52/52) — it never touches `interactions`. The
        other three initially did NOT pass unmodified once Task 2's policy
        edits were applied, because implementing AC-1/AC-3/AC-7 correctly is
        exactly what invalidated their pre-6.4 fixtures/assertions:
        - `interaction_note_authorship.sql` (Story 5.7's suite): its `single_g`
          fixture had `parent_admin1` INSERT a `kind='single_input'` row
          directly (to set up the pre-6.4 UPDATE-moderation-escape check),
          which this story's new `and kind <> 'single_input'` INSERT clause
          denies, aborting the whole script.
        - `interactions_targets.sql` (~"AC 5: a single_input-kind interaction
          on a shidduch-targeted row inserts"): the identical shape,
          inserting as a `parent_admin`-role login to prove
          `interactions_kind_check` accepts the kind — denied by RLS before
          reaching the constraint.
        - `single_field_scoping.sql` (Story 6.3's own suite): its Leah
          fixture suggestion is look_into+shared — exactly the shape this
          story's carve-out opens. Two checks ("AC2: single's INSERT into
          interactions is denied", "AC7: single sees zero rows in
          interactions_summary") were blanket "single can insert/read
          nothing" claims this story deliberately falsifies for this one
          kind on this one row — a direct logical conflict between 6.3's
          blanket-deny AC and 6.4's narrow-carve AC over the identical
          fixture row, not a fixture-authoring accident like the other two.
        None of these 3 files are in this story's declared ownership. Per
        `.claude/rules/parallel-ownership.md` ("Out-of-scope work is
        reported, not taken"), this story did not edit any of them —
        instead, each conflict was reported live via `SendMessage` to the
        dispatching session as it was found, naming the exact failing
        checks, the root cause, and a proposed minimal fix. **All three were
        subsequently fixed by another agent coordinating on the shared
        working tree** — `interaction_note_authorship.sql` and
        `interactions_targets.sql` via the proposed remedy (the one
        RLS-checked fixture-arrange INSERT in each moved to run as
        `postgres`/BYPASSRLS instead; the first also gained an anti-vacuity
        control and an updated AC-2 policy-count assertion for this story's
        two new policies), `single_field_scoping.sql` via a re-authored pair
        of assertions (the harder of the three, since it needed the claim
        itself to change, not just the arrange mechanism). This story does
        not take credit for those 3 diffs and does not include them in its
        own commit (`make commit` names only this story's own declared
        paths) — see Dev Agent Record for the full, live timeline. Final
        state, re-verified: all four regression suites green
        (`interaction_note_authorship.test.ts` 31/31,
        `interactions_targets.test.ts` 35/35,
        `single_row_scoping.test.ts` 52/52,
        `single_field_scoping.test.ts` 48/48).
  - [x] **Adjudication addendum (2026-07-30), from the agent that made those
        three diffs.** Three corrections and one open defect, recorded here
        because this story's text is where the next reader will look:
        1. **The ruling is recorded in Story 6.3, not here.** 6.3's **AC-2**
           now carries it in full: this story's carve-out is the product
           intent — `ARCHITECTURE-SPINE.md` **AD-3** makes the dignity floor
           **un-lowerable** ("the child always sees their live prospects
           **and can give input**"), **FR93** repeats it and adds "this
           cannot be switched off", and **FR66** spells out the capability.
           6.3's blanket deny was **over-broad as written, not wrong in
           spirit**; its own Task 2 had already scoped the claim to "at the
           end of *this* story", and only its *tests* turned a moment in the
           delivery order into a permanent invariant. **FR68** is not in
           tension: it withholds candid reference *content* from the single,
           and giving input reads nothing candid. 6.3's AC-2/AC-8 and its
           Task 2 bullet have been amended so no future agent "restores" the
           blanket deny and deletes this story's central feature.
        2. **There was a FOURTH collision, not three.**
           `interaction_note_authorship.sql`'s catalog check *"AC 2:
           interactions carries exactly {INSERT,SELECT,UPDATE} policies — no
           ALL, no DELETE"* asserted the exact **multiset of `cmd` values**,
           i.e. "exactly three policies, one per command". This story adds
           two by design, so it was red too. It was invisible in the
           original report because the `single_g` fixture INSERT aborted the
           script under `ON_ERROR_STOP` *before any results were emitted* —
           a suite that dies reports no checks at all, so the abort masked
           it. It is now split into `AC 2(a)` (no `ALL`, no `DELETE` — the
           permanent invariant the append-only audit trail rests on,
           untouched by this story) and `AC 2(b)` (the exact **name -> cmd**
           set, including this story's two policies by name). 2(b) is
           strictly stronger than what it replaced: it also catches a policy
           **rename**, which a `cmd`-multiset assertion can never see.
        3. **Final count corrected:** `single_field_scoping.test.ts` is
           **52/52**, not 48/48 — the re-authoring landed at 51 checks
           (47 - 2 + 6) plus the suite's own exact-count guard.
        4. **Open defect this story introduced and did NOT close —
           `interactions_summary.can_moderate` now lies.**
           `03_views.sql:304` still computes
           `kind not in ('note','single_input') or can_moderate_note(actor)`,
           which mirrors the UPDATE policy's **pre-6.4** shape. AC-3 made
           `single_input` unupdatable by **every** role, but
           `can_moderate_note()` returns true for the **author** — so a
           single reading her own input row is told `can_moderate = true`
           while the UPDATE affects **zero rows**. Verified live on stack 5:
           view says `t`, `UPDATE ... affected 0 rows`. Not fixed by the
           adjudicating agent: the fix is a view change, which needs a
           migration in `supabase/migrations/**` — a path **this story
           declares and was actively writing** — so it was left alone rather
           than written into another agent's in-flight ownership. **This is
           a real follow-up**, not cosmetic: it is the same class of defect
           (a view contradicting its policy) that 5.7's finding F2 fixed in
           the other direction, and no existing test catches it —
           `interaction_note_authorship.sql`'s `AC 5-single` check happens
           to probe a *non-author* caller, for whom the view is still
           correct.
  - [x] Frontend: component test for `SingleInputForm` (renders only for a
        `single` viewer, renders nothing while `isPending`, submit calls
        `create` with the exact fixed shape and never sends
        `actor_member_id`), plus an assertion that `ShidduchOverviewTab`
        mounts it. `vitest-browser-react` + `TestMemoryRouter`; React Testing
        Library is not a dependency. ≥80% coverage on new/changed files.
  - [x] `ShidduchRightRail.guard.test.ts` must pass **unmodified** — it is
        the mechanical statement of AC-6. Confirmed unmodified and green.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`.
        `typecheck`/`lint` clean. `make test STACK_ID=4`, final run: 215/215
        test files, 2373/2373 tests green (see the regression bullet above
        for the live timeline of the 3 files that needed a fix along the
        way, by another agent, to get there).

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

Claude (bmad-dev-story workflow), STACK_ID=4 / STACK_OWNER=6.4.

### Debug Log References

- Empirically verified (not assumed) that Task 2's policy edits, applied
  exactly as specified, break 3 of the 4 files Task 5 lists as
  "regression-only, must pass unmodified": generated the migration against a
  live STACK_ID=4 stack, applied it, and ran each named suite before/after.
  Baseline (pre-migration): `interaction_note_authorship.test.ts` 29/29,
  `single_row_scoping.test.ts` 52/52, `interactions_targets.test.ts` and
  `single_field_scoping.test.ts` green. After applying this story's
  migration: `interaction_note_authorship.test.ts` aborts entirely
  (`ERROR: new row violates row-level security policy for table
  "interactions"` at its own line 275 — a `parent_admin` fixture-arrange
  INSERT of `kind='single_input'`, legal before this story, illegal after);
  `interactions_targets.test.ts` loses 1 check (`AC 5: a single_input-kind
  interaction...inserts`, same shape, same root cause);
  `single_field_scoping.test.ts` loses 2 checks (`AC2: single's INSERT into
  interactions is denied`, `AC7: single sees zero rows in
  interactions_summary` — Leah's own fixture suggestion in that suite is
  look_into+shared, i.e. exactly the shape this story's carve-out opens, so
  those two blanket-deny assertions are directly superseded, not merely
  fixture-broken). `single_row_scoping.sql` stays 52/52 (it never touches
  `interactions`).
- Reported this live via `SendMessage` to `main` during implementation
  (before writing the frontend), naming the 3 files, the exact failing
  checks, the root cause for each, and a proposed minimal fix per file
  (change the fixture-arrange INSERT's execution context in the first two;
  re-author the two blanket-deny assertions in the third to acknowledge the
  new carve-out, e.g. asserting denial with `kind='note'` instead). This
  story's own scope was implemented and gated in full without waiting for a
  reply, per `.claude/rules/parallel-ownership.md` ("Out-of-scope work is
  reported, not taken... That report is a successful outcome").
- All 3 were subsequently fixed by another agent, coordinating on the
  shared working tree, while this story's own frontend/dataProvider/i18n
  work continued: `interaction_note_authorship.sql` and
  `interactions_targets.sql` via exactly the proposed remedy (each suite's
  one RLS-checked fixture-arrange INSERT moved to run as `postgres`/
  BYPASSRLS instead; the first also gained a new anti-vacuity control and an
  updated AC-2 policy-count assertion for this story's two new policies),
  `single_field_scoping.sql` via a re-authored pair of assertions (the
  harder of the three — a fixture-arrange tweak alone could not have fixed
  it, since the claim itself was superseded, not merely broken by role). This
  story did not author any of those 3 diffs and does not include them in its
  own commit — `make commit` below names only this story's own declared
  paths; the 3 fixes are left in the working tree for their own owner/wave
  to commit. Final re-verification, all four green:
  `interaction_note_authorship.test.ts` 31/31,
  `interactions_targets.test.ts` 35/35, `single_row_scoping.test.ts` 52/52,
  `single_field_scoping.test.ts` 48/48. Full `make test STACK_ID=4`:
  215/215 files, 2373/2373 tests.
- `make check-migration-safety STACK_ID=4`: PASSED — 32 seeded rows across
  19 tables survived intact.
- `supabase db diff --workdir .supabase-e2e-4`: "No schema changes found",
  run twice after `check-migration-safety`'s own full `db reset` cycle.

### Completion Notes List

- Implemented exactly the two new policies, the two clause edits, and the
  comment-block rewrite Task 2 specifies, verbatim to the story's own SQL —
  no deviation.
- `SingleInputForm.tsx` is a new, small, focused component (~115 lines):
  role-gated on `useViewerRole()`, writes via the standard `useCreate` hook
  (no bespoke RPC), never sends `actor_member_id`/`account_id`, and calls
  `useRefresh()` after a successful submit (the same idiom `NotesTab.tsx`'s
  `AddNoteForm` uses) so the right rail's `SingleInputPanel` — a sibling
  component elsewhere in the 360 view — shows the new row immediately.
- i18n keys landed as `crm.entity360.overview.singleInput.*`, alongside the
  existing generic `crm.entity360.overview.empty` key both
  `entity360/tabs/OverviewTab.tsx` and `shadchanim/ShadchanOverviewTab.tsx`
  already use for their own bespoke Overview tabs — this IS the "shidduch
  overview namespace" Task 4 refers to; there is no separate one to create.
- FakeRest parity in `dataProvider.ts` is two small additions to the
  existing `interactions` create/update branches: a role check
  (`kind === "single_input"` requires the caller's resolved membership role
  to be `"single"`) and an append-only check on the STORED kind
  (`previousData.kind === "single_input"` always throws on update,
  regardless of which columns the payload touches). Neither duplicates the
  real RLS visibility join — the narrow parity Task 4 asks for.
- **Named cost carried forward, per the story's own Dev Notes**: there is no
  retraction path for a `single_input` row after this story. A future
  product decision to add one needs its own AC and its own write path, not a
  silent re-widening of the UPDATE policy's clause.
- **Cross-story interaction worth a reviewer's attention, even though it
  resolved clean**: implementing this story's own ACs correctly made 3
  pre-existing test files (owned by Stories 5.7, 3.5, and 6.3 respectively)
  fail. None were in this story's ownership, so none were edited by this
  story — each was reported live via `SendMessage` with a root cause and a
  proposed fix, and all 3 were fixed by another agent coordinating on the
  shared working tree before hand-off (see Debug Log References and the
  Task 5 regression bullet for the full, empirically-verified timeline).
  This story's own commit does not include those 3 diffs.
- All gates are clean: `make typecheck`, `make lint`, `npx prettier --check .`
  (repo-root run surfaces 16 pre-existing warnings in `.github/workflows/*.yml`
  and `doc/**/*.mdx` — none touched by this story; `make lint`'s own
  narrower prettier check, scoped to `{mjs,js,json,ts,tsx,css,md,html}`, is
  clean), `make build`, all four CI guard scripts
  (`check-suppressions.mjs`, `check-retired-names.mjs`,
  `check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs`), the
  full `app`/`workers`/`scripts` vitest projects (1289/1289 on `app` alone),
  `make check-migration-safety`, `supabase db diff` clean twice, and
  `make test STACK_ID=4` (215/215 files, 2373/2373 tests, final run).

### File List

Schema / DB:
- `supabase/schemas/05_policies.sql` — two new policies ("Single reads own
  input", "Single adds input on a visible suggestion"), the INSERT policy's
  `and kind <> 'single_input'` clause, the UPDATE policy's `using`/
  `with check` clause rewrite, and its comment block rewritten.
- `supabase/migrations/20260730192236_single_input_policies.sql` — new,
  generated via `supabase db diff` against STACK_ID=4 and hand-checked
  (`CREATE POLICY` × 2 + `DROP POLICY`/`CREATE POLICY` × 2, nothing else).
- `supabase/tests/single_input.sql` — new.
- `supabase/tests/single_input.test.ts` — new.

Frontend:
- `src/components/atomic-crm/shidduchim/SingleInputForm.tsx` — new.
- `src/components/atomic-crm/shidduchim/SingleInputForm.test.tsx` — new.
- `src/components/atomic-crm/shidduchim/ShidduchOverviewTab.tsx` — mounts
  `SingleInputForm` above `ShidduchCatchSection`.
- `src/components/atomic-crm/shidduchim/entityDescriptor.test.tsx` — new
  describe block asserting the Overview tab mounts `SingleInputForm` for a
  `single` viewer and never for a `parent_admin` viewer.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — the
  `interactions` create/update branches gain the single-role-only
  `single_input` insert guard and the append-only update guard.
- `src/components/atomic-crm/providers/fakerest/dataProvider.interactions.test.ts`
  — the pre-existing single_input-insert test now runs as an explicit
  single-role session; new tests cover the non-single rejection, the
  append-only guard (own author and a separate `parent_admin` session), and
  the `note`-moderation-untouched regression.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — new
  `entity360.overview.singleInput.*` keys.
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — same,
  translated.
- `registry.json` — regenerated (`make registry-gen`); the only change is
  the new `SingleInputForm.tsx` entry.

Not touched by this story (regression-only, per this story's own file
ownership) — see Debug Log References:
`supabase/tests/interaction_note_authorship.sql`,
`supabase/tests/interactions_targets.sql`, and
`supabase/tests/single_field_scoping.sql` (all 3 needed, and received, a fix
from another agent coordinating on the shared working tree, to keep passing
once this story's ACs landed — not this story's own commit; see Debug Log
References for the full timeline and why),
`supabase/tests/single_row_scoping.sql` (passes genuinely unmodified,
52/52),
`supabase/tests/dbSuiteHelpers.ts` (the shared fixture needed no new case),
`src/components/atomic-crm/shidduchim/ShidduchRightRail.tsx`,
`src/components/atomic-crm/shidduchim/SingleInputPanel.tsx`,
`src/components/atomic-crm/shidduchim/ShidduchRightRail.guard.test.ts`,
`src/components/atomic-crm/entity360/useViewerRole.ts`.

### Change Log

- Two new `interactions` RLS policies (single reads/inserts own
  `single_input`), the general INSERT policy's `kind <> 'single_input'`
  clause, and the UPDATE policy narrowed to deny `single_input` to every
  role — a deliberate append-only decision (Dev Notes), not incidental.
- New `SingleInputForm.tsx` mounted in the shidduch Overview tab; the
  single's write surface for their input on a visible suggestion.
- FakeRest parity for the role-gated insert and the append-only update
  guard.
- Flagged, not silently patched: implementing this story's own ACs made 3
  pre-existing db test files (owned by other stories) fail as a direct,
  verified consequence — reported live rather than edited out of scope. All
  3 were subsequently fixed by another agent coordinating on the shared
  working tree; none are part of this story's own commit. See Task 5 and
  Dev Agent Record for the full account.

### Post-merge follow-up — the view that drifted from this story's policy

Landed after this story, by a separate agent, as
`20260730202040_fix_interactions_summary_can_moderate_single_input.sql`.
Recorded here because it is this story's policy rewrite that the defect
was a consequence of, not a defect of its own.

**What was wrong.** AC 3 narrowed the `interactions` UPDATE policy to
`kind not in ('note', 'single_input') or (kind = 'note' and
can_moderate_note(actor_member_id))`, making `single_input` append-only
for every role. `interactions_summary.can_moderate` (03_views.sql) was
left on the Story 5.7 shape, `kind not in ('note', 'single_input') or
can_moderate_note(...)`, which still calls `can_moderate_note()` on a
`single_input` row. That function returns true for the row's **author**,
so the view advertised `can_moderate = t` on a row every UPDATE path
refuses — a single reading back her own submitted input was offered an
edit control the database answers with 0 rows affected. The policy and
the view disagreed from the moment AC 3 landed.

**Why the existing suites stayed green.** Both `single_input` view checks
in `interaction_note_authorship.sql` — check (g2) and `AC 5-single` —
read the view as `helper1`, who is neither the fixture row's author nor
an owning role. `can_moderate_note()` is false for that caller, so the
drifted view returned the right answer by the wrong route. No check
anywhere read the view as a caller `can_moderate_note()` returns **true**
for, which is the only caller the two shapes differ on.

**Regression assertion added.** `(g3)` in
`supabase/tests/interaction_note_authorship.sql`, as `parent_admin1` —
the fixture row's author. It asserts the *agreement* itself,
`can_moderate = (rows > 0)`, rather than either value alone, and pins the
row's visibility through the view first so a missing fixture fails the
check instead of vacuously passing it. Proven red before the fix
(`can_moderate=t rows=0`) and green after (`can_moderate=f rows=0`).

**Known sibling — CLOSED, not open** (this paragraph previously ended
"Reported, not patched"; that is no longer true and the stale text was
the exact hazard this file warns about elsewhere — prose that invites a
later agent to "restore" a fixed bug in good faith). The FakeRest read
path, `enrichInteractions()` in
`src/components/atomic-crm/providers/fakerest/dataProvider.ts`, computed
`canModerate = row.kind !== "note" || isAuthor ||
callerOwnsCurrentContext` — the Story **3.6** shape, which never received
5.7's `single_input` widening either. For `kind === 'single_input'` that
was `true` for *every* caller, so in demo mode the moderation control
rendered on every single's-input row and clicking it hit this story's own
append-only guard in `update()` (which *was* updated correctly) and threw.

**Fixed in `a736175`**, by the same agent that fixed the SQL half, once
that agent's ownership window on this file opened. The shipped expression
is now the De Morgan of the policy's own clause:

```ts
const canModerate =
  (row.kind !== "note" && row.kind !== "single_input") ||
  (row.kind === "note" && (isAuthor || callerOwnsCurrentContext));
```

Regression test: `"reports can_moderate: false for a single_input row, for
its own author and for a parent_admin"` in
`dataProvider.interactions.test.ts`. Its falsifiability was **re-verified
independently** (2026-07-30, orphaned-findings pass): reverting the
expression to `row.kind !== "note" || isAuthor || callerOwnsCurrentContext`
turns it red (`expected true to be false`, 1 failed / 17 passed);
restoring turns it green (18/18).

### Review findings 2-7 — adjudicated, not inherited

This story's review raised one MUST-FIX (finding 1, closed above) and six
"does not block" findings. The fix agent closed finding 1's two halves and
characterised 3/4/5 as "story-prose accuracy issues in a file neither of us
owns", 2 as "inherent to RLS composition", 6 as "pre-existing/demo-only",
7 as informational. Those were reasonable calls made by an agent with an
interest in them not blocking, and nobody owned the file they landed in.
They are re-judged here, independently, against the shipped tree — because
"neither of us owns it" is how work disappears. Verdicts below.

**Finding 2 — three INSERT-policy clauses have zero test sensitivity.
CONFIRMED, not a bug, and the forward risk is real.** Deleting any of
`is_single_visible_state(s.pipeline_state)`, `c.member_id =
current_member_id()`, or `actor_member_id = current_member_id()` from
`"Single adds input on a visible suggestion"` leaves `single_input.test.ts`
19/19 green. The reviewer's diagnosis is correct: RLS applies to tables
referenced *inside* a policy's own `EXISTS` subquery, so `"Shidduchim
visible to single"` (Story 6.2) has already filtered `public.shidduchim`
down to the single's own shared, visible-state rows before this policy's
join runs, and the actor clause is satisfied by construction because
`set_interaction_actor_member_id` is a BEFORE INSERT trigger. The clauses
are correct defence-in-depth and must not be deleted as dead code — but
**no test in this repo would catch it if they were, and no test would catch
a mistake in them the day they become load-bearing.** They become
load-bearing the moment any story widens `"Shidduchim visible to single"`
or gives a single a second read path into `shidduchim`. Story 6.5
(self-manager parity) is the live candidate; the risk is written into its
story file rather than left here.

**Finding 3 — AC-7's stated mechanism is wrong. CONFIRMED, real, fixed
above.** `06_grants.sql` grants table-wide `insert` on `public.interactions`
to `authenticated` (`grant select, insert, update on table
public.interactions`); only UPDATE is column-narrowed (`revoke update …` /
`grant update (body, metadata, deleted_at) …`). So a client **can** name any
`actor_member_id` in an INSERT payload, and the only thing that stops the
forgery is the BEFORE INSERT trigger `set_interaction_actor_member_id`
overwriting it. This is not cosmetic: AC-7 named a protection that does not
exist, and the policy's own `actor_member_id = current_member_id()` clause
evaluates *after* the trigger has already overwritten the value (05_policies
says so in its own comment), so it pins the trigger rather than catching a
live forgery. An agent trusting AC-7 could remove or weaken that trigger
believing the grant layer had it covered, and every negative test would stay
green. AC-7's parenthetical now says so. **AC-2 is accurate as written** —
it names the *UPDATE* grant, which genuinely does withhold the column; the
review's "AC-2/AC-7" framing over-reached by one AC.

**Finding 4 — AC-6's rationale is inaccurate. CONFIRMED, fixed above.**
`ShidduchCatchSection` writes nothing (`useRedirect` + a session-local
`useState` set; its own file comment states it). `SingleInputForm` is the
first mutation surface on the Overview tab. The placement decision survives
on its two true reasons; the false precedent has been struck so no later
story can cite it.

**Finding 5 — pre-existing `single_input` rows become permanently
un-editable. CONFIRMED as a mechanism, effectively empty in practice, and
the practical part is what was missing.** The reviewer verified there is no
data loss (`check-migration-safety` PASSED, the migration is DDL-only).
What was not written down is the exposure: **no shipped code path could
create a `single_input` row before this story.** `single_input` entered the
`kind` check in Story 5.7, but `SingleInputPanel.tsx` only *reads* it
(`useGetList` with `kind: "single_input"`), and `SingleInputForm.tsx` — the
first and only writer — is this story's own. Production is at `b6e2a2b`
(Epics 1-5), so any pre-existing row could only have come from a direct
PostgREST/SQL call by an account member, not from the app. The deploy round
therefore needs no backfill or carve-out for them; if one is ever found,
it is frozen by design (AC-3) and the retraction question re-opens as its
own decision, exactly as Dev Notes says.

**Finding 6 — FakeRest parity is write-side only. CONFIRMED, still open,
demo-only, and now explicitly owned rather than orphaned.** The write half
is mirrored: `create()` refuses a `single_input` from a non-`single`
session, `update()` refuses every `single_input` edit. The read half is not
mirrored at all — `getList`/`getOne` for `interactions` /
`interactions_summary` apply no role filter, so a demo `single` session
reads every interaction in the fixture, including the parent's candid
`note` rows. Real RLS (`"Interactions readable within account and parent
visibility"`'s `current_member_role() <> 'single'` plus `"Single reads own
input"`) makes this impossible against a real backend, so there is **no
production exposure** — but demo mode is where the single's-access story is
shown to people, and it currently shows the opposite of what Epic 6 built.
Pre-existing from Story 6.3, widened in scope by this story's carve-out.
**Not fixed here** — `providers/fakerest/dataProvider.ts` was under another
story's active ownership at the time of this pass (Story 6.1, live on it).
**Handoff:** whoever next holds that file mirrors the two SELECT policies in
the interactions read path, with a test that a `single`-role FakeRest
session sees only its own `single_input` rows.

**Finding 7 — ownership/red-main. CONFIRMED and closed.** `d8b831a` touched
exactly its 14 declared paths; the three out-of-ownership suites it
invalidated were repaired in `a7e071b`, so `main` was red between those two
commits. Re-verified at `a736175` on an independent stack: 215 test files,
2376 tests, all green; `check-migration-safety` PASSED; `db diff` clean
twice against the committed schemas; all four CI guards pass.
