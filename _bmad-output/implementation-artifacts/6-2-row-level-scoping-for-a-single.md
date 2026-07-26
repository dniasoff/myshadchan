# Story 6.2: Row-level scoping for a single

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want a single to see only the rows they should, enforced in Postgres,
so that privacy is structural, not a UI convention that a modified client
could bypass.

## Position in Epic 6

**1st of 5 to build, despite being numbered 6.2.** Epic 6's delivery order is
pinned, exactly as Epic 1's was, and for the same reason: numbering follows
the user's story (join → see → understand what's hidden → speak → self-manage),
build order follows what is safe to expose.

**Binding delivery order: 6.2 → 6.3 → 6.4 → 6.1 → 6.5.**

1. **6.2 (this story) first.** It introduces the `single` role's row-visibility
   rules and the two small helper functions every later Epic 6 story calls.
   Nothing about a real single login exists yet when this story lands — it is
   built and tested with directly-inserted `account_members` rows (the same
   technique `supabase/tests/*.sql` already uses), never through a live invite.
2. **6.3 before 6.4.** 6.3 puts `interactions` into "deny the single role by
   default." 6.4 then carves the one exception (`single_input`) into that
   default. Building 6.4 first would mean writing the exception before the
   rule it is an exception to.
3. **6.1 after 6.2/6.3/6.4.** 6.1 is the story that produces a **real**
   `account_members` row with `role = 'single'` bound to a live login. If 6.1
   landed before the scoping in 6.2–6.4, a real single's first sign-in would
   land on the unrestricted, pre-Epic-6 policies (full account read) for
   however long the gap lasted. Building the fence before opening the gate.
4. **6.5 last.** It is a parity/regression guard over 6.2–6.4 (proving
   `self_manager` is *not* caught by any of this story's `= 'single'`
   predicates) plus an onboarding copy audit — there is nothing for it to
   guard until 6.2–6.4 exist.

## Acceptance Criteria

1. **A single sees a suggestion only when three things are simultaneously
   true:** it belongs to their own `singles` row (not a sibling's), its
   `visibility` is `'shared'`, and its `pipeline_state` is one of the three
   single-visible states (`look_into`, `yes`, `unsure`). A suggestion missing
   any one of the three is invisible to them — this is the epic's "gut
   set-asides and rejected suggestions are absent" plus the un-stated but
   architecturally required sibling exclusion (see Dev Notes "Why sibling
   exclusion is this story's, not an invention").

2. **The single sees their own resume-adjacent facts for a visible
   suggestion** — `resumes` and `shidduch_schools` rows tied to a suggestion
   that passes AC-1 are readable; rows tied to any other suggestion, or to a
   sibling's suggestion, are not.

3. **The single sees their own `singles` row and nothing else in that table**
   — not a sibling's, not another household's (already impossible via
   `account_id`, but the same-household sibling case is the one worth naming).

4. **The single can read the household's basic account info (e.g. the
   household name shown in the app shell) but cannot change it.** `accounts`
   is `SELECT`-only for the `single` role; insert/update/delete stay denied.

5. **Every other account-scoped table not named in AC-1–4 denies the `single`
   role outright — zero rows, on every command.** Specifically:
   `account_members`, `date_records`, `redts`, `identity_signals`,
   `inbox_items`, `subscription`, `ai_usage`. None of these is required by any
   Epic 6 story; default-deny is the safe posture per AD-1, and each is named
   explicitly in Dev Notes with the one-line reason it is denied rather than
   left to the pre-existing blanket policy.

6. **None of the above touches any role other than `single`.** A
   `parent_admin`, `helper` or `self_manager` member's access is byte-for-byte
   unchanged — same rows, same commands, before and after this story's
   migration. This is proven by re-running the existing account-isolation
   assertions in `references_entity.sql` unmodified and green.

7. **Negative test, required by `.claude/rules/security-triggers.md`:** two
   singles in the **same household** (siblings), each with their own
   `account_members` row and `singles` row; a suggestion visible to sibling A
   returns zero rows when queried as sibling B, and vice versa. A second
   negative test proves a `single` role member gets zero rows from each table
   in AC-5, in the same account, in the same test run.

8. **The role-resolution helpers are single-owner.** Exactly one function
   resolves "what role does the caller hold in their active context"
   (`current_member_role()`) and exactly one resolves "which
   `account_members` row is the caller's own" (`current_member_id()`); no
   policy or function re-implements either lookup inline.

## Tasks / Subtasks

- [ ] **Task 0 — Reuse check, before writing anything** (AC: 8)
  - [ ] `grep -rniE "current_member_role|current_member_id|is_single\(|member_role_in_context" supabase/schemas/*.sql` and `LSP workspaceSymbol` for the same names. Epic 2 (Story 2.1/2.2, context-aware authorisation) may already have shipped an equivalent role-resolution helper by the time this story is picked up — reuse it under its existing name rather than adding a duplicate. Everything below assumes neither exists yet; if one does, substitute its name throughout and skip the matching half of Task 1.
  - [ ] `grep -n "account_members_role_check" supabase/schemas/01_tables.sql` and confirm `'single'` is already a valid value (added by Epic 2 Story 2.2, per `personas-and-contexts.md`'s role vocabulary). If it is **not** yet there, this is a blocking gap in Epic 2's landed scope, not something to silently route around — add the one missing enum value to the existing check constraint with a comment citing this story, and flag it in the PR description; do not invent a different string for "single" to avoid touching Epic 2's table.

- [ ] **Task 1 — Add the two role-resolution helpers** (AC: 8)
  - [ ] `supabase/schemas/02_functions.sql`, colocated immediately after `current_context_id()` (AD-19): add
    ```sql
    -- The single authority for "what role does the caller hold in their
    -- active context" (AD-2). SECURITY DEFINER so it can be called from RLS
    -- policies without recursing into account_members' own policies (same
    -- reason current_context_id() is SECURITY DEFINER). Returns NULL if the
    -- caller has no active membership — fails closed, same as current_context_id().
    CREATE OR REPLACE FUNCTION "public"."current_member_role"() RETURNS text
        LANGUAGE "sql" STABLE SECURITY DEFINER
        SET "search_path" TO ''
        AS $$
      select am.role
      from public.account_members am
      where am.user_id = auth.uid()
        and am.account_id = public.current_context_id()
        and am.status = 'active'
      order by am.id
      limit 1;
    $$;

    -- The single authority for "which account_members row is the caller's
    -- own, in their active context." Reused by this story's policies and by
    -- 6.4's single_input attribution. `order by id limit 1` mirrors
    -- current_account_id()'s existing tie-break; account_members has no
    -- uniqueness constraint on (account_id, user_id) today (Epic 2's to add,
    -- not this story's), so this stays deterministic rather than assuming one.
    CREATE OR REPLACE FUNCTION "public"."current_member_id"() RETURNS bigint
        LANGUAGE "sql" STABLE SECURITY DEFINER
        SET "search_path" TO ''
        AS $$
      select am.id
      from public.account_members am
      where am.user_id = auth.uid()
        and am.account_id = public.current_context_id()
        and am.status = 'active'
      order by am.id
      limit 1;
    $$;
    ```
  - [ ] `supabase/schemas/06_grants.sql`: `revoke all on function public.current_member_role(), public.current_member_id() from public, anon;` then `grant execute ... to authenticated, service_role;` — mirror the existing `current_account_id()` grant block exactly.

- [ ] **Task 2 — Split the `shidduchim` policy: full access for everyone except `single`, narrow read for `single`** (AC: 1)
  - [ ] In `supabase/schemas/05_policies.sql`, change the existing account-scoped policy on `public.shidduchim` (post-1.3/2.1 rename, reads `current_context_id()`) to add `and public.current_member_role() <> 'single'` to both its `using` and `with check`. This is the one line that stops the pre-existing blanket policy from granting a single role full CRUD.
  - [ ] Add a second, `SELECT`-only policy:
    ```sql
    create policy "Shidduchim visible to single" on public.shidduchim
        for select to authenticated
        using (
            account_id = public.current_context_id()
            and public.current_member_role() = 'single'
            and visibility = 'shared'
            and public.is_single_visible_state(pipeline_state)
            and exists (
                select 1 from public.singles c
                where c.id = shidduchim.single_id
                  and c.member_id = public.current_member_id()
            )
        );
    ```
    (Column/table names above are post-1.3: `shidduchim.single_id`, `public.singles`. If this story is picked up before 1.3 lands — it should not be, per the pinned cross-epic order — use `child_id` / `public.children` instead and flag it.)

- [ ] **Task 3 — Same split for `resumes` and `shidduch_schools`** (AC: 2)
  - [ ] Add `and public.current_member_role() <> 'single'` to each table's existing "for all" policy.
  - [ ] Add one `SELECT`-only policy per table with the join:
    ```sql
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and exists (
            select 1
            from public.shidduchim s
                join public.singles c on c.id = s.single_id
            where s.id = resumes.shidduchim_id       -- shidduch_schools.shidduchim_id for the other table
              and s.visibility = 'shared'
              and public.is_single_visible_state(s.pipeline_state)
              and c.member_id = public.current_member_id()
        )
    );
    ```
  - [ ] Note for the implementer at this story's actual position: if Epic 5 has by then added a separate resume surface for **the single's own outbound resume** (Story 5.8 — "their resume is the one I send out to shadchanim" implies a resume not tied to any `shidduchim_id`), extend this task to cover that surface too with the equivalent "own `singles` row" predicate from Task 4. Grep `supabase/schemas/01_tables.sql` for a `resumes` column/table added after this story was written before assuming the shape above is complete.

- [ ] **Task 4 — Split `public.singles`: full access for everyone except `single`, own-row read for `single`** (AC: 3)
  - [ ] Add `and public.current_member_role() <> 'single'` to the existing "for all" policy (named `"Singles scoped to account"` post-1.3).
  - [ ] Add:
    ```sql
    create policy "Singles visible to self" on public.singles
        for select to authenticated
        using (
            account_id = public.current_context_id()
            and public.current_member_role() = 'single'
            and member_id = public.current_member_id()
        );
    ```

- [ ] **Task 5 — `accounts`: read-only for `single`** (AC: 4)
  - [ ] Add `and public.current_member_role() <> 'single'` to the existing `"Account access scoped to member"` policy's `using`/`with check`.
  - [ ] Add:
    ```sql
    create policy "Account readable to single" on public.accounts
        for select to authenticated
        using (
            id = public.current_context_id()
            and public.current_member_role() = 'single'
        );
    ```

- [ ] **Task 6 — Wholesale deny for `single` on the seven tables that have no stated Epic 6 use** (AC: 5)
  - [ ] For each of `account_members`, `date_records`, `redts`, `identity_signals`, `inbox_items`, `subscription`, `ai_usage`: add `and public.current_member_role() <> 'single'` to every existing policy's `using` (and `with check` where present). Use `<>`, not `is distinct from` — see Dev Notes "The NULL trap this story avoids."
  - [ ] One-line reason per table, to go in the schema comment beside each edited policy:
    - `account_members` — the household roster and its `invited_by`/`status` chain; no Epic 6 story needs a single to browse it.
    - `date_records` — dating history `notes` is free-text and unaudited for candour; out of scope for this epic's ACs, deny by default.
    - `redts` — the redt history's own `note` field is shadchan/parent commentary, same reasoning as `date_records`.
    - `identity_signals` — internal match-key store; also spans **every** single in the household (it is not `singles`-row-scoped), so a naive read would leak cross-sibling signals.
    - `inbox_items` — raw, pre-confirm captures; the least triaged, most candid layer in the product (AD-6).
    - `subscription`, `ai_usage` — billing/entitlement; household-owner business, not a single's concern.

- [ ] **Task 7 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_role_row_scoping`
  - [ ] Confirm the diff contains only `CREATE FUNCTION`, `CREATE POLICY`, and `ALTER POLICY ... USING ...` statements — no `DROP TABLE`/`CREATE TABLE` (this story renames nothing). Re-issue the two function grants from Task 1 if the diff omits them (function grants are commonly dropped by `db diff`, per AGENTS.md's warning about phantom diffs).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset --local`, never `db push`.

- [ ] **Task 8 — Tests** (AC: 6, 7)
  - [ ] New `supabase/tests/single_row_scoping.sql` + `.test.ts` pair, same shape as `references_entity.sql`/`.test.ts` (temp `results`/`ids` tables, `set local request.jwt.claims`, roll back at the end). Arrange: one household account, one `parent_admin`, two `single`-role `account_members` rows each linked via `member_id` to their own `singles` row (siblings "Leah" and "Rivka"), and for each sibling: one `look_into`+`shared` suggestion (should be visible to them, invisible to the other), one `new` suggestion (invisible to both), one `look_into`+`private_parent` suggestion (invisible to both — visibility overrides state).
  - [ ] Assertions (AC-7): sibling A reading `shidduchim` as `single` gets exactly her own visible suggestion, zero of her sibling's, zero of the `new`/`private_parent` ones. Repeat as sibling B.
  - [ ] Assertions (AC-5/7): as either single, `select count(*) from public.account_members` / `date_records` / `redts` / `identity_signals` / `inbox_items` / `subscription` / `ai_usage` each return `0`, even though the parent's session (re-asserted in the same test) sees non-zero rows in at least `account_members`.
  - [ ] Assertion (AC-4): as a single, `select` on `accounts` returns the household row; `update public.accounts set name = 'x'` raises (RLS violation).
  - [ ] Assertion (AC-6, regression guard): re-run `npm run test:unit:db` in full — every existing assertion in `references_entity.sql` and `shidduch_catch.sql` (parent-role account isolation) still passes unmodified.
  - [ ] `make typecheck && npm run lint && npm run test:unit:db` (needs `make start`). No frontend files change in this story, so `make test` (vitest app suite) needs no new assertions here, but must still stay green.

## Dev Notes

### Why sibling exclusion is this story's, not an invention

The epic's literal AC-6.2 wording ("they see only shared suggestions in
child-visible states") does not spell out the sibling case, but the glossary
is explicit that a `single` is "the person being redt for... your own child,
**or yourself**" — the dignity floor is about *my own* process. Every family
shape in `personas-and-contexts.md` that includes "singles with their own
logins" (shape 5) is built on top of shapes with multiple `singles` rows per
household (any shape with more than one child). Without the `member_id`
join in Task 2/3/4, a single with a login would see every sibling's pipeline
too — which is not "the same views as the parent, filtered," it is the
parent's own unfiltered view. This is decided here, not deferred, per the
epic's own "no unresolved decisions" instruction.

### The NULL trap this story avoids

`current_member_role()` returns `NULL` when the caller has no active
membership (fail-closed, mirroring `current_context_id()`). The natural
instinct for "every role except single" is `current_member_role() IS
DISTINCT FROM 'single'` — but `NULL IS DISTINCT FROM 'single'` evaluates to
**`true`**, which would grant the wholesale-deny tables' broadened policies
to a caller with *no* role at all. Plain `<>` returns `NULL` (falsy in a
`USING` clause) for that case, so it fails closed the way every other
predicate in this schema does. Use `<>` everywhere in this story, never `IS
DISTINCT FROM`, for the "not single" direction.

### The two-policy pattern, and why it is not a rewrite of the existing policy

Every table this story touches keeps its existing "for all" policy
byte-for-byte except for one added clause (`and public.current_member_role()
<> 'single'`) — AC-6's regression requirement. The new `single`-scoped
behaviour is **additive**: a second, `SELECT`-only, `single`-scoped policy.
Postgres OR-combines permissive policies per command, so a `parent_admin`
caller (for whom the new clause on the old policy is trivially true) is
unaffected, and a `single` caller (for whom the old policy's new clause is
now false) falls through to seeing only what the new policy grants. This is
the same pattern Postgres RLS documentation calls out for exactly this
scenario, and it is why Task 2–6 never touch a policy's row-producing logic,
only its role gate.

### What this story deliberately does not decide

- **`shadchanim`, `"references"`, `reference_links`, `interactions`** — not
  touched here. `shadchanim`/`references` carry a mix of safe and candid
  content (per-column, not per-row); `reference_links`/`interactions` are
  candid by construction. All four are **Story 6.3**'s ("field-level
  scoping"), because the decision for each is about *content*, not *which
  rows exist*. Do not pre-empt 6.3 by touching them here.
- **A single's own outbound resume** (if Epic 5 gives `singles` its own
  resume surface distinct from per-suggestion `resumes`) — flagged in Task 3
  as a grep-first check, not designed here, because the schema shape does not
  exist at the time this story is written.
- **`account_members` visibility for roles other than the wholesale deny in
  Task 6** — e.g. whether a `helper` should see less than a `parent_admin` is
  a real, named gap (see this epic's final report), but no Epic 6 story asks
  for it; do not expand this story to cover it.

### Testing standard

SQL suites in this repo are plain scripts, not pgTAP: a `results` temp table
accumulates `(name, passed, detail)` rows inside a single rolled-back
transaction, and a matching `*.test.ts` loads the file, runs it via
`execFileSync`/psql against `SUPABASE_DB_URL`
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres` by default), and
turns each row into a named Vitest assertion — see
`supabase/tests/references_entity.sql` + `.test.ts` for the exact shape to
copy. Multi-user scenarios switch identity with
`set local role authenticated; set local request.jwt.claims =
'{"sub":"<uuid>","role":"authenticated"}';` — never a real Supabase Auth
session. AAA structure per `.claude/rules/testing.md`: the accounts/singles
arrangement is one block, each assertion is one `insert into results`.

### Project Structure Notes

No new files under `src/`; this is a schema + migration + SQL-test story.
New/changed files:
- `supabase/schemas/02_functions.sql` (two new functions)
- `supabase/schemas/05_policies.sql` (policy edits across 10 tables)
- `supabase/schemas/06_grants.sql` (two new function grants)
- `supabase/migrations/<timestamp>_single_role_row_scoping.sql` (generated + hand-checked)
- `supabase/tests/single_row_scoping.sql`, `supabase/tests/single_row_scoping.test.ts` (new)

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — exactly one scoping axis per row,
  deny-by-default, FORCE RLS.
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary
  (`parent_admin | single | helper | self_manager | shadchan`), active-context
  authorisation.
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_context_id()`, fail-closed
  NULL semantics, `current_account_id()` deleted not wrapped.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — pipeline-state visibility is a single
  authority (`is_single_visible_state`, renamed from `is_child_visible_state`
  by story 1.3), never re-implemented per caller.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
  — shape 5, "singles with their own logins," is the scenario this story's
  negative test proves.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-6-The-Singles-Access]
  — Story 6.2's literal AC text.
- Current schema (pre-Epic-1 names, translated throughout this story to their
  post-1.3 equivalents): `supabase/schemas/01_tables.sql` (`children`,
  `shidduchim.child_id`, `shidduchim.visibility`/`owner_member_id`),
  `supabase/schemas/05_policies.sql` (existing account-scoped policies),
  `supabase/schemas/02_functions.sql` (`current_account_id()`,
  `is_child_visible_state()` — the exact functions this story's helpers sit
  beside and reuse).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
