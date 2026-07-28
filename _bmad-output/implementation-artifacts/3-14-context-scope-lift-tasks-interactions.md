# Story 3.14: Context scope lift — `tasks` and `interactions`

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan working inside my own shadchanus context,
I want to be able to record a task and log an interaction at all,
so that the universal Tasks, Notes and Activity tabs are not structurally dead outside a
household.

## Position in Epic 3

**Step 7 of the epic's build order, and a hard blocking dependency of 3.5, 3.6 and 3.8.**
This story is pure database work with no framework dependency, so it can be written and
rehearsed in parallel with 3-13 / 3.1 / 3.3a / 3.9 / 3.2 / 3.3b / 3.4 — but the migration
must be **applied before any of 3.5, 3.6 or 3.8 is started**, because all three build and
test surfaces that write to `public.tasks` or `public.interactions`, and both writes raise a
raw Postgres exception in a shadchanus context until this lands.

**This story is not in `epics.md`.** It was added by Epic 3's re-story pass to carry a
project-owner ruling (see the next section); `epics.md`'s Epic 3
[Source: _bmad-output/planning-artifacts/epics.md:452-455] has no Story 3.14 heading yet.
This story therefore derives its acceptance from AD-1, AD-2 and the ruling, not from an
`epics.md` AC block. Adding the heading to `epics.md` is documentator follow-up, not dev work
inside this ticket.

**Scope boundary — read before starting.** This story removes exactly **two triggers** and
fixes the comments and tests that count them. It changes **no policy**, **no function body**,
**no constraint**, **no grant**, and **no React component**. In particular it does *not*
widen `interactions_target_type_check` or `interactions_scope_link_check`
[Source: supabase/schemas/01_tables.sql:458-460,473-477] — that is Story 3.5's job — and it
does not widen `tasks_target_type_check` [Source: supabase/schemas/01_tables.sql:45-47],
which is Story 3.8's.

## The ruling this story carries, and what the schema comment actually warns about

`enforce_household_scope()` raises unless the row's `account_id` belongs to a
`kind = 'household'` account [Source: supabase/schemas/02_functions.sql:387-402], and it is
attached to 13 tables as `validate_<table>_household_scope`
[Source: supabase/schemas/04_triggers.sql:159-209] — including
`validate_interactions_household_scope` [Source: supabase/schemas/04_triggers.sql:195-197]
and `validate_tasks_household_scope` [Source: supabase/schemas/04_triggers.sql:207-209].
`set_account_id_default()` fills `account_id` from `current_context_id()` on every insert
that does not carry one [Source: supabase/schemas/02_functions.sql:359-369], so **today, a
caller whose active context is a shadchanus account cannot insert a single row into either
table**: the value the `set_*` trigger writes is exactly the value the `validate_*` trigger
then rejects, with `account % is not a household-kind account` /
`errcode = 'check_violation'` [Source: supabase/schemas/02_functions.sql:396-397].

That makes Activity, Notes and Tasks — the three universal tabs of Stories 3.5, 3.6 and 3.8 —
structurally unavailable in the one context where a shadchan actually works, against AD-2's
*"`shadchan` is active, not deny-only"*
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:62-65]
and against Epic 8 Story 8.5's premise, *"I want to … do my work here instead of falling back
to a notebook"* [Source: _bmad-output/implementation-artifacts/8-5-shadchans-own-crm.md:9-11].
**The project owner ruled that the restriction is lifted for these two tables** rather than
rescoping the universal tabs to household contexts or deferring Epic 8.5. The other 11 tables
are untouched: a shadchanus account still may not hold a `single`, a `shidduch`, a
`reference`, a `resume`, a `reference_link`, a `date_record`, a `redt`, a `shidduch_school`,
an `identity_signal` or an `inbox_item`, and a `shadchanim` row still belongs to the
household that keeps it.

**What the "total insert outage" warning is about, precisely.** The comment at
`04_triggers.sql:147-158` reads *"Renaming any of these is a migration-time total insert
outage, not a refactor"* — the hazard is **name ordering**, not removal. Postgres fires
same-event BEFORE triggers in alphabetical trigger-name order, and the `validate_*` names
were chosen so they sort after every `set_*`/`sync_*` trigger on the same table (`'v' > 's'`),
which is what lets `set_account_id_default()` populate `account_id` before
`enforce_household_scope()` validates it. Rename a `validate_*` trigger to something sorting
before the `set_*` and it validates a NULL `account_id` on every insert and fails
closed — for all 13 tables at once, because the function is shared.

This story therefore **never touches the function, and never touches a trigger name**. It
drops two triggers, in one transaction, and drops nothing else. DDL is transactional in
Postgres, so there is no intermediate state in which one table has lost its check and the
other has not, and no state in which any table is left with a check that fires against a NULL.
The only real-world risk is lock contention — `drop trigger` takes `ACCESS EXCLUSIVE` on the
table, which *queues* concurrent inserts rather than failing them — and AC 2's `lock_timeout`
guard bounds it by aborting (and rolling back) instead of piling up behind a long transaction.

## Acceptance Criteria

1. **Exactly two triggers are removed from `04_triggers.sql`, and nothing else in
   `supabase/schemas/` changes except comments.** The `create or replace trigger
   validate_interactions_household_scope` block
   [Source: supabase/schemas/04_triggers.sql:195-197] and the `create or replace trigger
   validate_tasks_household_scope` block
   [Source: supabase/schemas/04_triggers.sql:207-209] are deleted from the schema file. The
   body of `enforce_household_scope()` [Source: supabase/schemas/02_functions.sql:387-402] is
   byte-identical afterwards, every one of the 11 surviving `validate_*_household_scope`
   triggers keeps its exact current name, and `set_interactions_account_id`
   [Source: supabase/schemas/04_triggers.sql:131-133], `set_tasks_account_id`
   [Source: supabase/schemas/04_triggers.sql:123-125] and `sync_task_target_trigger`
   [Source: supabase/schemas/04_triggers.sql:127-129] are unchanged. **Fails if** `git diff
   supabase/schemas/` shows any non-comment change other than the two deleted trigger blocks.

2. **The generated migration is four statements and contains no `create`.** After
   `db diff`, the migration file consists of, in order: `set lock_timeout = '3s';`, the two
   `drop trigger … on public.interactions;` / `… on public.tasks;` statements, and
   `set lock_timeout = default;`. It matches **none** of `create or replace function`,
   `create trigger`, `create or replace trigger`, `alter table`, `drop function`. The
   `lock_timeout` pair is session-level (`set`, not `set local`) so it is valid whether or not
   the CLI wraps the file in an explicit transaction, and it is reset at the end so it cannot
   leak into a later migration on the same connection. **Fails if** migra emits a
   drop-and-recreate pair, or touches the function, or the hand-added guards are missing.

3. **Every comment that counts the household-only set says 11, and the two that assert
   something now false about `interactions`/`tasks` are rewritten, not just renumbered.**
   **Find them with a newline-tolerant grep, not a line-based one** — two of the seven sites
   put the `13` and the words `household-only` on *different lines*, so `grep "13 household"`
   silently misses `04_triggers.sql` and `01_tables.sql` and would let this AC pass with the
   two most important comments unfixed:

   ```
   grep -rIlzE "\b13\b[^;]{0,120}household" supabase/ src/
   ```

   It lists exactly six files today — `01_tables.sql`, `02_functions.sql`, `04_triggers.sql`,
   `06_grants.sql`, `context_resolution.sql`, `accountDomainData.ts`. The seven sites inside
   them:
   - `supabase/schemas/04_triggers.sql:147-158` — "all 13 household-only domain tables … the
     exact set that already carries a `set_<table>_account_id` trigger above". Both halves are
     now false: the count is 11, and `interactions`/`tasks` still carry their `set_*` trigger
     while no longer carrying a `validate_*` one. Rewrite the sentence and record why the two
     left (this story, the owner ruling).
   - `supabase/schemas/02_functions.sql:376-386` — `enforce_household_scope()`'s own preamble,
     "Attached (04_triggers.sql) to all 13 household-only domain tables".
   - `supabase/schemas/02_functions.sql:647-655` — `account_has_domain_data()`'s preamble,
     which claims the check covers *"every one of the 13 household-only domain tables
     `enforce_household_scope()` already enumerates"* and that *"a shadchanus account can never
     have a row in any of these tables today (the same trigger forbids it)"*. Both are now
     false for two of its 13 `exists` arms. **The function body
     [Source: supabase/schemas/02_functions.sql:656-674] is not changed** — it must keep
     checking all 13 tables, because "does this account still hold real data" is exactly the
     question a shadchanus account can now answer *yes* to.
   - `supabase/schemas/01_tables.sql:556-559` — the `subscription`/`ai_usage` carve-out
     comment, "deliberately excluded from `enforce_household_scope()`'s 13 household-only
     tables". The two `comment on table` statements at `:560-561` name no count and stay
     byte-identical (changing them would put DDL in the migration, contradicting AC 2).
   - `src/components/atomic-crm/providers/fakerest/internal/accountDomainData.ts:5-15` — "one
     of `enforce_household_scope()`'s 13 household-only tables". Its `DOMAIN_RESOURCES` array
     [Source: src/components/atomic-crm/providers/fakerest/internal/accountDomainData.ts:16-29]
     mirrors `account_has_domain_data()` and therefore **keeps** `interactions` and `tasks`.
   - `supabase/schemas/06_grants.sql:273-277` — "`enforce_household_scope()` is the shared
     trigger function backing the 13 `validate_*_household_scope` triggers". Count only; the
     three grant statements at `:278-280` stay byte-identical (they are DDL — see AC 2).
   - `supabase/schemas/05_policies.sql:31-32` — "Account-scoped like the rest of the shidduchim
     domain (AD-1)" above the `tasks` policy. True as written (the policy is unchanged); add
     one clause noting the table is no longer household-only so the next reader does not infer
     it from the neighbourhood.

   **Fails if** the grep above lists any file after Task 1 **and** Task 5 have both run
   (`context_resolution.sql`'s six occurrences — `:9`, `:535`, `:579`, `:595`, `:623`, `:659`
   — belong to AC 6, not to this AC). If the grep flags a file this list does not name, read
   the `-o` output before editing: a stray `13` within 120 characters of the word `household`
   is a false positive, not a site.
   `src/components/atomic-crm/providers/fakerest/internal/removePersona.test.ts:261-263` says
   *"production's `enforce_household_scope()` trigger forbids this on a real shadchanus
   account today"* about a **`shadchanim`** row — still true, **do not touch it**.

4. **The four required database outcomes, in a new `db` suite.** A new
   `supabase/tests/household_scope_lift.sql` + `household_scope_lift.test.ts` pair (harness
   shape copied from `supabase/tests/context_rls_hardening.test.ts` — `isolatedScript()`,
   one JSON row per check, `bailIfDbUnreachable` from
   `supabase/tests/dbSuiteHelpers.ts`) asserts, with one login `U` holding a `parent_admin`
   membership of household account `A` and a `shadchan` membership of shadchanus account `B`:
   (a) with `B` active, `insert into public.tasks (target_type, target_id, text)` **succeeds**
   and the row lands with `account_id = B`;
   (b) with `B` active, `insert into public.interactions (target_type, target_id)` **succeeds**
   with `account_id = B`;
   (c) with `B` active, `insert into public.singles (first_name_en)` **still raises**, and the
   message matches `%is not a household-kind account%` — matching the message, not merely
   asserting that *something* raised, because `singles` has other constraints that would raise
   just as happily (this is the trap `context_resolution.sql:577-584` documents);
   (d) `select count(*) from pg_trigger where tgfoid = 'public.enforce_household_scope'::regproc
   and not tgisinternal` **= 11**, and neither `public.tasks` nor `public.interactions` appears
   in `tgrelid` for that function.

   (b) uses `target_type = 'reference'`, `scope = 'account'`, `reference_link_id = null`.
   `interactions_scope_link_check` permits three shapes
   [Source: supabase/schemas/01_tables.sql:473-477]; this is the only one of the three that
   needs **no** household row to exist — the other two require a real `reference_links` row or
   a real `shidduchim` row, neither of which a shadchanus account can hold. `target_id` carries
   no FK by design [Source: supabase/schemas/01_tables.sql:671-673], so any non-null bigint
   satisfies it, and the `scope = 'account'` disjunct of the policy matches unconditionally
   [Source: supabase/schemas/05_policies.sql:267,293]. A
   `shadchan`- or `single`-targeted interaction is **Story 3.5's** widening and must not be
   attempted here — it would fail on the constraint, not on this story's change, and would
   read as a false negative.

5. **Cross-context isolation is proved to come from the context predicate, in both
   directions, for both tables.** In the same suite, with the same single login `U`:
   (a) rows created while `B` was active are invisible to `U` after
   `select public.set_active_context(A)` — `select count(*)` over `public.tasks` and
   `public.interactions` returns **0** for those ids;
   (b) after `select public.set_active_context(B)` the same login sees them again, and now sees
   **0** of `A`'s rows;
   (c) with `A` active, an insert that **explicitly supplies** `account_id = B` is rejected by
   the RLS `with check`, for both tables. This arm is the load-bearing one: `set_account_id_default()`
   only fills a **NULL** `account_id` [Source: supabase/schemas/02_functions.sql:363-366], so
   before this story a client-supplied foreign `account_id` was caught by
   `enforce_household_scope()` on the way past; afterwards the only thing standing there is
   `account_id = public.current_context_id()` in `"Tasks scoped to account"`
   [Source: supabase/schemas/05_policies.sql:33-36] and in `"Interactions scoped to account and
   parent visibility"` [Source: supabase/schemas/05_policies.sql:262-315]. **Fails if** either
   insert succeeds.
   The negative shape is deliberately **one login with two memberships**, never two disjoint
   users: two disjoint users pass without ever exercising `current_context_id()`'s
   active-context resolution, which is the thing that would actually regress (AD-19)
   [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:148-151].

6. **`context_resolution.sql` is corrected, not left to go red, and loses no coverage.**
   Seven edits [Source: supabase/tests/context_resolution.sql]:
   - `:9-10` — the file header's "`enforce_household_scope()` on the 13 household-only domain
     tables" (11);
   - `:535` — the loop's own preamble, "every one of the 13 household-only domain tables" (11);
   - `:546-550` — drop `'interactions'` and `'tasks'` from `v_tables` (the loop now proves the
     raise for 11 tables);
   - `:561-569` — delete the `if v_table = 'tasks'` special case, now unreachable, which
     collapses the loop body to the single `execute format(… (account_id) …)` arm;
   - `:577-584` — the "vacuous assertion" note counts the tables with a mandatory
     non-defaulted column besides `account_id` as "9 of the 13". Both departing tables were in
     that 9 (`interactions.target_type`/`target_id` and `tasks.target_id` are `not null`
     [Source: supabase/schemas/01_tables.sql:43-44,436-437]). **Recount against the surviving
     11 rather than assuming 7** — the note's value is that the number is right;
   - `:594-596` — `= 13` becomes `= 11`, and the check's name changes with it (the test file
     turns each row's `name` into a test title, so a stale title is a lie in the report);
   - `:621-672` — the AC-3a trigger-ordering proof: its label and its conjunction drop to the
     11 remaining tables. **The `interactions` insert at `:647` and the `tasks` insert at
     `:656` stay**, re-asserted under a **new, separately named** check ("`set_account_id_default()`
     still populates `account_id` on `interactions` and `tasks` now that no household-scope
     trigger follows it") — deleting them would silently drop the only proof that the `set_*`
     trigger still runs on those two tables.
   Two replacement checks are added next to the loop so the suite's check count does not drop:
   AC 4(a) and AC 4(b)'s positive cases, stated as "`enforce_household_scope` no longer rejects
   a shadchanus-kind `account_id` on `<table>`". **Fails if** `npm run test:unit:db` reports
   fewer checks than `expect(checks.length).toBeGreaterThanOrEqual(95)`
   [Source: supabase/tests/context_resolution.test.ts:92] — if the count genuinely drops below
   the floor after these edits, lower the floor in the same diff and say so in Completion Notes;
   do not pad the suite.

7. **Rehearsed locally against a pristine database, red before green, recorded.** The
   sequence in Task 4 is run end to end on the local stack and its output is pasted into
   Completion Notes. With the new suite written but the migration **not** applied, the suite
   must still **run to completion and report** — it must not abort — and must show:
   4(a), 4(b) **RED** with detail containing `is not a household-kind account`; 4(d) **RED**
   (the count is still 13); 5(a) and 5(b) **RED** *for a different reason* — their fixture rows
   were never created, so the "invisible from A" arm passes vacuously while the "visible again
   from B" arm fails; 4(c) and 5(c) **green**, because neither depends on the drop.
   After `migration up --local`, every check in AC 4 and AC 5 is green — 4(c) included, which
   is the whole point: the other 11 tables did not move.
   **Fails if** the story is submitted without the red run pasted in, or if the pre-migration
   run aborts instead of reporting — a check that was never shown failing is not evidence
   [Source: .claude/rules/testing.md].

8. **Nothing under `src/` changes except one doc comment.** `git diff --name-only` lists at
   most `src/components/atomic-crm/providers/fakerest/internal/accountDomainData.ts`, and
   `git diff` on it shows a comment-only change. No FakeRest code path emulates
   `enforce_household_scope()` for `interactions` or `tasks` — verified: the only two mentions
   of the function in `src/` are the doc comment in AC 3 and the `shadchanim` comment in AC 3's
   "do not touch" note — so AD-10's keep-FakeRest-in-lockstep obligation
   [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:103-107]
   is discharged by having nothing to change. **Fails if** any `.tsx` file appears in the diff,
   or if the `accountDomainData.ts` diff contains a single line of executable code.

## Tasks / Subtasks

- [ ] **Task 1 — Schema edit** (AC: 1, 3)
  - [ ] Delete the two `create or replace trigger` blocks at `04_triggers.sql:195-197` and
        `:207-209`. Do not reformat, reorder or rename anything else in the file.
  - [ ] Rewrite the comment at `04_triggers.sql:147-158` per AC 3 — the count **and** the
        "exact set that already carries a `set_<table>_account_id` trigger" claim, which is
        what a future developer would otherwise use to re-derive the list and re-add the two.
  - [ ] Rewrite the two `02_functions.sql` preambles (`:376-386`, `:647-655`) and the
        `01_tables.sql:556-559` carve-out comment. **Do not touch any function body**, and do
        not touch the `comment on table` statements at `01_tables.sql:560-561` — those are DDL
        and would land in the migration.
  - [ ] Add the clause to `05_policies.sql:31-32`.
  - [ ] Fix the doc comment in
        `src/components/atomic-crm/providers/fakerest/internal/accountDomainData.ts:5-15`;
        leave `DOMAIN_RESOURCES` alone.
  - [ ] `grep -rIlzE "\b13\b[^;]{0,120}household" supabase/ src/` lists only
        `supabase/tests/context_resolution.sql` (Task 5 clears that one).

- [ ] **Task 2 — Generate and hand-edit the migration** (AC: 2)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        lift_household_scope_tasks_interactions`
        [Source: AGENTS.md#Database-Management].
  - [ ] Read the generated file before applying it. It must contain the two `drop trigger`
        statements and nothing else. If migra emits a `create or replace trigger` alongside a
        drop — the shape it sometimes produces for a definition change rather than a
        removal — **stop**: that means a trigger block was edited rather than deleted, or the
        function was touched. Fix the schema file and regenerate; do not hand-delete the
        recreate.
  - [ ] Hand-add `set lock_timeout = '3s';` as the first statement and
        `set lock_timeout = default;` as the last, with a one-line SQL comment giving the
        reason (bound the `ACCESS EXCLUSIVE` wait; abort and roll back rather than queue).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.

- [ ] **Task 3 — The new `db` suite** (AC: 4, 5)
  - [ ] `supabase/tests/household_scope_lift.sql` — preamble copied from
        `supabase/tests/context_rls_hardening.sql:37-44` (`\set ON_ERROR_STOP on`, `begin;`,
        the `results` and `ids` temp tables, `grant all … to public`), one login `U` with a
        `parent_admin` membership of household `A` and a `shadchan` membership of shadchanus
        `B` (that role pairing is mandatory — `enforce_membership_role_matches_context()`
        rejects any other, [Source: supabase/schemas/02_functions.sql:404-411]), context
        switching via `select public.set_active_context(:acct);`
        [Source: supabase/tests/context_resolution.sql:228,1022], one `results` row per check,
        JSON array emitted at the end, `rollback`.
  - [ ] Every raise-expecting check wraps its statement in a `begin … exception when others`
        block and asserts on `sqlerrm`, not merely on "an exception happened" — the failure
        mode `context_resolution.sql:577-584` documents.
  - [ ] **The success-expecting checks (4(a), 4(b)) are wrapped the same way**, recording
        `passed = false` plus `sqlerrm` in the `results` row rather than letting the insert
        propagate. `\set ON_ERROR_STOP on` is on
        [Source: supabase/tests/context_rls_hardening.sql:37], so an unwrapped failing insert
        aborts the whole script and emits no JSON — which is exactly what AC 7's pre-migration
        run must not do. AC 5's fixture rows come from the same wrapped block, so when they are
        absent the dependent checks report `false`, they do not crash.
  - [ ] `supabase/tests/household_scope_lift.test.ts` — copy of
        `supabase/tests/context_rls_hardening.test.ts`'s runner (dynamic `it` per check name,
        `bailIfDbUnreachable`, a `toBeGreaterThanOrEqual` floor equal to the number of checks
        actually written).
  - [ ] This is the story's security-triggers-mandated negative test
        [Source: .claude/rules/security-triggers.md] — the diff drops a database trigger, so
        SECURITY-REVIEWER is dispatched on it regardless.

- [ ] **Task 4 — The rehearsal, red then green** (AC: 7)
  - [ ] Confirm the local stack holds nothing the developer needs: this step recreates it.
        `supabase/seed.sql` is empty (0 bytes) and every `db` suite builds its own fixtures
        inside a rolled-back transaction, so a reset restores exactly the migrated schema and
        no data.
  - [ ] With Task 1's schema edits **stashed or not yet made** and Task 2's migration **not**
        applied, but Task 3's suite present:
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db reset --local`, then
        `npm run test:unit:db`. The suite must **report** (not abort) with the exact red/green
        split AC 7 states — 4(a), 4(b), 4(d), 5(a), 5(b) red; 4(c), 5(c) green. Paste the red
        lines into Completion Notes.
        *(Standing rule note: 3.5-3.8's "never `db reset --local`" applies to ordinary
        migration work. The owner's ruling requires this migration be rehearsed from a
        pristine migrated state, so the reset is authorised for this story only, on the local
        stack only, and never `db push`.)*
  - [ ] Apply Task 1 + Task 2, re-run `npm run test:unit:db`: all of AC 4, AC 5 and the
        corrected `context_resolution` checks green.
  - [ ] `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`.

- [ ] **Task 5 — Correct `context_resolution.sql`** (AC: 6)
  - [ ] The seven edits and the two replacement checks listed in AC 6.
  - [ ] Re-verify `checks.length` against the `>= 95` floor at
        `supabase/tests/context_resolution.test.ts:92`; adjust the floor only if it genuinely
        drops, and record the before/after counts in Completion Notes.

## Dev Notes

### Why there is no safe "staged" variant, and why staging would be the dangerous choice

The instinct on reading "migration-time total insert outage" is to stage: widen
`enforce_household_scope()` to allow `shadchanus` for these two tables first, then drop the
triggers. **That is the change that would cause the outage.** `enforce_household_scope()` is
one function shared by 13 triggers [Source: supabase/schemas/02_functions.sql:376-386]; making
it table-aware means it reads `TG_TABLE_NAME`, which changes behaviour for all 13 at once and
puts a `create or replace function` in the migration — and the function is required to be in
exact `pg_dump` form or `db diff` produces a phantom diff on every later story
[Source: AGENTS.md#Database-Management]. Dropping two triggers is strictly smaller, strictly a
relaxation, and leaves the other 11 tables provably identical (AC 4(d) counts them).

The second instinct — drop and re-add under a narrower condition — would re-add the two
triggers with new names, which is precisely the alphabetical-ordering hazard the schema
comment warns about. Neither is done here.

### Where isolation actually comes from, after this story

It always came from the context predicate. `enforce_household_scope()` compares
`accounts.kind`, not account identity — it never prevented one tenant reading another's rows,
and it never was the tenant boundary. What it did do incidentally is reject a *client-supplied*
foreign `account_id` on the way past when the foreign account happened to be shadchanus. After
this story the only thing rejecting that insert is the RLS `with check`, on both tables
[Source: supabase/schemas/05_policies.sql:33-36,262-315] — which is why AC 5(c) exists and why
it must supply `account_id` explicitly rather than relying on `set_account_id_default()`.

Both tables' `account_id` FKs point at `public.accounts(id)` with no kind restriction
[Source: supabase/schemas/01_tables.sql:674-675,687-688], so a shadchanus `account_id` is a
valid value on both the moment the trigger is gone. No FK, index or grant changes.
`interactions` grants stay `select, insert, update` with `update` column-scoped to
`(body, metadata)`; `tasks` stays `select, insert, update, delete`
[Source: supabase/schemas/06_grants.sql:596-603,615-616].

### Trigger ordering after the drop

`interactions` is left with one BEFORE trigger (`set_interactions_account_id`) and `tasks`
with two (`set_tasks_account_id`, `sync_task_target_trigger`), all `set_`/`sync_`-prefixed, so
no ordering question survives on either table. The ordering assertion that remains in the
suite is `singles`-based [Source: supabase/tests/context_resolution.sql:598-605] and is
unaffected.

### What this story deliberately leaves broken for 3.5 and 3.8

After this migration a shadchanus context can hold a task, but `tasks_target_type_check` still
allows only `('shadchan', 'shidduch', 'reference')`
[Source: supabase/schemas/01_tables.sql:45-47], and an interaction, but only in the
`(scope = 'account', target_type = 'reference', reference_link_id is null)` branch of
`interactions_scope_link_check` [Source: supabase/schemas/01_tables.sql:473-477] — the other
two branches need a household row that a shadchanus account cannot have. That is expected and
is why AC 4(b) pins its fixture to `target_type = 'reference'`. 3.5 and 3.8
widen the vocabulary; this story only removes the context gate that would have made their work
untestable in the context it matters for.

### Testing standard

AAA; `db` project only (`npm run test:unit:db`), which shells out to `psql` against the local
stack and skips itself when the database is unreachable outside CI
[Source: supabase/tests/dbSuiteHelpers.ts]. Start the stack with
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase start`; a bare `npx supabase start`, or any
wrapper target that omits the prefix, hangs on the keyring and looks like a Docker fault
[Source: ~/.claude/projects/-home-daniel-repos-myshadchan/memory/supabase-cli-dbus-hang.md].
No `app`-project test is added: this story ships
no component. `.claude/rules/testing.md`'s 80% rule is satisfied by AC 4-6, which cover every
behaviour the diff changes.

### Migration workflow

Edit `supabase/schemas/*.sql` → `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff
--local -f <name>` → hand-check → `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration
up --local`. Never `db push` [Source: AGENTS.md#Database-Management]. `db reset --local` is
authorised **only** for Task 4's rehearsal, for the reason stated there.

### Project Structure Notes

- No new directory. Two new files under `supabase/tests/`, alongside the seven existing
  suites, following `context_rls_hardening.{sql,test.ts}`'s shape.
- One new file under `supabase/migrations/`.

### References

- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:57-60]
  — AD-1, one scoping axis, RLS scoped to `current_context_id()`
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:62-66]
  — AD-2, `shadchan` is active not deny-only; a shadchanus context holds no *household domain*
  rows (the rule this story narrows to 11 tables)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:148-151]
  — AD-19, `current_context_id()`, the fail-closed active-context resolution the negative test
  must exercise
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:168-172]
  — UX-DR5's per-entity tab matrix; Notes / Tasks / Activity on every entity
- [Source: supabase/schemas/02_functions.sql:387-402] — `enforce_household_scope()`, unchanged
  by this story; its raise message and errcode at `:396-397`
- [Source: supabase/schemas/02_functions.sql:359-369] — `set_account_id_default()`, and the
  NULL-only guard at `:363-366` that AC 5(c) turns on
- [Source: supabase/schemas/02_functions.sql:656-674] — `account_has_domain_data()`, body
  unchanged, preamble corrected
- [Source: supabase/schemas/04_triggers.sql:147-158] — the trigger-naming rationale and the
  "total insert outage" warning this story reads before acting
- [Source: supabase/schemas/04_triggers.sql:195-197, 207-209] — the two triggers dropped
- [Source: supabase/schemas/05_policies.sql:33-36, 262-315] — the two policies that carry
  isolation afterwards, both unchanged
- [Source: supabase/schemas/01_tables.sql:31-51, 432-478] — the two tables, their constraints,
  and (`:45-47`, `:458-460`, `:473-477`) the checks 3.5/3.8 widen, not this story
- [Source: supabase/tests/context_resolution.sql:543-605, 621-672] — the existing 13-table
  loop, count assertion and ordering proof this story corrects
- [Source: supabase/tests/context_rls_hardening.sql, context_rls_hardening.test.ts] — the
  harness shape the new suite copies
- [Source: supabase/tests/dbSuiteHelpers.ts] — `bailIfDbUnreachable`
- [Source: _bmad-output/implementation-artifacts/8-5-shadchans-own-crm.md:9-19] — the
  downstream consumer whose premise this story unblocks
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md,
  3-6-universal-notes-tab.md, 3-8-universal-tasks-tab.md] — the three stories this one blocks
- [Source: .claude/rules/security-triggers.md, .claude/rules/testing.md,
  .claude/rules/coding-style.md, .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
