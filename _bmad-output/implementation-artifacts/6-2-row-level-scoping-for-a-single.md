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
   rules and the one new helper function every later Epic 6 story calls.
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

2. **The single sees their own resume-adjacent facts** — `resumes` and
   `shidduch_schools` rows tied to a suggestion that passes AC-1 are readable,
   and so is the single's **own outbound resume** (the post-5.8 shape where
   `resumes.single_id` is set and `shidduchim_id` is null, pointing at their
   own `singles` row — see Dev Notes "The own-resume decision"). Rows tied to
   any other suggestion, to a sibling's suggestion, or to a sibling's own
   resume are not.

3. **The single sees their own `singles` row and nothing else in that table**
   — not a sibling's, not another household's (already impossible via
   `account_id`, but the same-household sibling case is the one worth naming).

4. **The single can read the `accounts` rows of the contexts they belong to
   (the app shell and context switcher need the household name) but cannot
   write any of them.** Reads keep Story 2.1 AC-7's membership-lookup shape
   unchanged; insert/update/delete are denied to the `single` role (see Dev
   Notes "Why `accounts` splits per command").

5. **Every other account-scoped table not named in AC-1–4 denies the `single`
   role — zero rows on every command — except `account_members`, where the
   single keeps exactly their own membership row(s) and never the household
   roster.** The zero-row tables: `tasks`, `invites`, `date_records`, `redts`,
   `identity_signals`, `inbox_items`, `subscription`, `ai_usage`. None is
   required by any Epic 6 story; default-deny is the safe posture per AD-1,
   and each is named in Task 6 with the one-line reason it is denied. Tables
   deliberately **not** in this list: `shadchanim`, `"references"`,
   `reference_links`, `interactions`, `entity_files`,
   `shidduchim_external_links`, `medical_notes` (all Story 6.3's, candid
   content), `resume_photos` (already denies `single` with its own negative
   test, Story 5.4).

6. **None of the above touches any role other than `single`.** A
   `parent_admin`, `helper` or `self_manager` member's access is byte-for-byte
   unchanged — same rows, same commands, before and after this story's
   migration. This is proven by re-running the existing account-isolation
   assertions in `references_entity.sql` unmodified and green.

7. **Negative test, required by `.claude/rules/security-triggers.md`:** two
   singles in the **same household** (siblings), each with their own
   `account_members` row and `singles` row; a suggestion visible to sibling A
   returns zero rows when queried as sibling B, and vice versa. A second
   negative test proves a `single` role member gets zero rows from each
   zero-row table in AC-5, and only their own row from `account_members`, in
   the same account, in the same test run.

8. **Role resolution is single-owner.** Exactly one new function resolves
   "what role does the caller hold in their active context"
   (`current_member_role()`), and it derives from Story 3.5's existing
   `current_member_id()` — which this story **reuses and must not redefine**
   (3.5 declares it "defined once, here"; a `CREATE OR REPLACE` here would
   silently overwrite the function 3.6's note-author RLS already depends on).
   No policy re-implements either lookup inline.

## Tasks / Subtasks

- [ ] **Task 0 — Reuse check, before writing anything** (AC: 8)
  - [ ] `grep -rniE "current_member_role|current_member_id|is_single\(" supabase/schemas/*.sql`
        and `LSP workspaceSymbol` for the same names — against the tree as it
        stands, i.e. after Epics 2–5. Expected: `current_member_id()` exists
        (Story 3.5), `current_member_role()` does not. If a role-resolution
        equivalent already landed under another name in any prior epic, reuse
        it under its existing name and skip Task 1's function half.
  - [ ] `grep -n "account_members_role_check" supabase/schemas/01_tables.sql`
        and confirm `'single'` is a valid value (added by Story 2.2 AC-2). If
        it is not, that is a blocking gap in Epic 2's landed scope — add the
        one missing value to the existing check constraint with a comment
        citing this story and flag it in the PR; do not invent a different
        string for "single".

- [ ] **Task 1 — Add `current_member_role()`** (AC: 8)
  - [ ] `supabase/schemas/02_functions.sql`, colocated immediately after
    `current_member_id()`:
    ```sql
    -- The single authority for "what role does the caller hold in their
    -- active context" (AD-2). Derived from current_member_id() (3.5) so the
    -- membership-row resolution stays single-owner. SECURITY DEFINER so RLS
    -- policies can call it without recursing into account_members' own
    -- policies (same reason current_context_id() is SECURITY DEFINER).
    -- Returns NULL when the caller has no active membership — fails closed.
    CREATE OR REPLACE FUNCTION "public"."current_member_role"() RETURNS text
        LANGUAGE "sql" STABLE SECURITY DEFINER
        SET "search_path" TO ''
        AS $$
      select am.role
      from public.account_members am
      where am.id = public.current_member_id();
    $$;
    ```
    No tie-break is needed: Story 2.1 AC-8's partial unique index
    (`account_members (account_id, user_id) where status = 'active'`) makes
    the membership row unique.
  - [ ] `supabase/schemas/06_grants.sql`: `revoke all on function
        public.current_member_role() from public, anon;` then `grant execute
        ... to authenticated, service_role;` — mirror the existing
        `current_context_id()` grant block exactly.

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
    (Column/table names are post-1.3: `shidduchim.single_id`, `public.singles`. If this story is picked up before 1.3 lands — it should not be, per the pinned cross-epic order — use `child_id` / `public.children` instead and flag it.)

- [ ] **Task 3 — Same split for `resumes` and `shidduch_schools`** (AC: 2)
  - [ ] Add `and public.current_member_role() <> 'single'` to each table's existing "for all" policy.
  - [ ] `shidduch_schools`: one `SELECT`-only policy with the join:
    ```sql
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and exists (
            select 1
            from public.shidduchim s
                join public.singles c on c.id = s.single_id
            where s.id = shidduch_schools.shidduchim_id
              and s.visibility = 'shared'
              and public.is_single_visible_state(s.pipeline_state)
              and c.member_id = public.current_member_id()
        )
    );
    ```
  - [ ] `resumes`: the same policy plus the own-resume branch — Story 5.8 has
        by now made `shidduchim_id` nullable and added `single_id`
        (exactly-one-set check), so the `single`-scoped `SELECT` policy is:
    ```sql
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and (
            exists (  -- a visible suggestion's resume (join as above,
                      -- on resumes.shidduchim_id)
                select 1
                from public.shidduchim s
                    join public.singles c on c.id = s.single_id
                where s.id = resumes.shidduchim_id
                  and s.visibility = 'shared'
                  and public.is_single_visible_state(s.pipeline_state)
                  and c.member_id = public.current_member_id()
            )
            or exists (  -- the single's own outbound resume (5.8 shape)
                select 1 from public.singles c
                where c.id = resumes.single_id
                  and c.member_id = public.current_member_id()
            )
        )
    );
    ```

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

- [ ] **Task 5 — `accounts`: read stays, writes deny `single`** (AC: 4)
  - [ ] Post-2.1 AC-7, `"Account access scoped to member"` is a `for all`
        policy whose `using`/`with check` is a membership `exists` lookup (so
        the context switcher can read non-active contexts). A blanket
        `<> 'single'` on its `using` would break the switcher and the app
        shell for a single. Instead, **split it per command**, preserving the
        membership lookup verbatim in both:
    - `"Accounts readable to their members"` — `for select`, the existing
      membership-`exists` predicate, **no role guard**.
    - `"Accounts writable by non-single members"` — `for insert, update,
      delete`, the existing membership-`exists` predicate `and
      public.current_member_role() <> 'single'` in **both** `using` and
      `with check` (the `using` half is what stops a single's `DELETE`, which
      never consults `with check`).
  - [ ] This split changes nothing for any other role (AC-6): the OR of the
        two policies reproduces the old policy exactly when the role guard
        passes.

- [ ] **Task 6 — Deny for `single` on the remaining tables with no stated Epic 6 use** (AC: 5)
  - [ ] For each of `tasks`, `invites`, `date_records`, `redts`,
        `identity_signals`, `inbox_items`, `subscription`, `ai_usage`: add
        `and public.current_member_role() <> 'single'` to every existing
        policy's `using` (and `with check` where present —
        `identity_signals`/`subscription`/`ai_usage` are `SELECT`-only and
        have none). Use `<>`, not `is distinct from` — see Dev Notes "The
        NULL trap this story avoids".
  - [ ] `account_members` is the one special case. Its post-2.1 policy is
        `user_id = auth.uid() or account_id = current_context_id()`; guard
        only the roster branch, keeping the own-rows branch (which
        `my_contexts()` — `SECURITY INVOKER`, Story 2.4 — depends on):
    ```sql
    using (
        user_id = auth.uid()
        or (account_id = public.current_context_id()
            and public.current_member_role() <> 'single')
    )
    ```
    same shape in `with check`.
  - [ ] One-line reason per table, to go in the schema comment beside each edited policy:
    - `account_members` (roster branch) — the household roster and its `invited_by`/`status` chain; no Epic 6 story needs a single to browse it. Own rows stay: sign-in and context resolution need them.
    - `tasks` — the family's follow-through work (CAP-6); free-text `text` routinely names candid diligence steps.
    - `invites` — membership management is an owning-role concern (2.7 AC-3 already refuses `single` callers in `create_invite()`); this also closes the direct-PostgREST insert surface for the `single` role.
    - `date_records` — dating history `notes` is free-text and unaudited for candour.
    - `redts` — the redt history's own `note` field is shadchan/parent commentary.
    - `identity_signals` — internal match-key store; spans **every** single in the household (not `singles`-row-scoped), so a naive read would leak cross-sibling signals.
    - `inbox_items` — raw, pre-confirm captures; the least triaged, most candid layer in the product (AD-6).
    - `subscription`, `ai_usage` — billing/entitlement; household-owner business.
  - [ ] **Completeness sweep** — the lists above were verified against the
        schema as of this story's writing plus every table Epics 2–5's
        stories add; re-verify at implementation time rather than trusting
        them:
    ```sql
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'account_id'
    where n.nspname = 'public' and c.relkind = 'r' order by 1;
    ```
    Every table returned must be classified exactly once: AC-1–4 allow set,
    AC-5 deny set, Story 6.3's list (`shadchanim`, `"references"`,
    `reference_links`, `interactions`, `entity_files`,
    `shidduchim_external_links`, `medical_notes`), Story 6.4's exception, or
    already single-denying with its own test (`resume_photos`, 5.4). An
    unclassified table is a blocker, not a silent pass-through. (Non-`account_id`
    relations — `members`, `member_state`, `pipeline_transitions`,
    `configuration` — are outside this epic's axis: the first two are
    user-scoped and Epic 2's, the last two are global reference data.)

- [ ] **Task 7 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_role_row_scoping`
  - [ ] Confirm the diff contains only `CREATE FUNCTION`, `CREATE POLICY`, and `ALTER POLICY`/`DROP POLICY`+`CREATE POLICY` statements — no `DROP TABLE`/`CREATE TABLE` (this story renames nothing). Re-issue the function grant from Task 1 if the diff omits it (function grants are commonly dropped by `db diff`, per AGENTS.md's warning about phantom diffs).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset --local`, never `db push`.

- [ ] **Task 8 — Tests** (AC: 6, 7)
  - [ ] New `supabase/tests/single_row_scoping.sql` + `.test.ts` pair, same shape as `references_entity.sql`/`.test.ts` (temp `results`/`ids` tables, `set local request.jwt.claims`, roll back at the end). Arrange: one household account, one `parent_admin`, two `single`-role `account_members` rows each linked via `member_id` to their own `singles` row (siblings "Leah" and "Rivka"), and for each sibling: one `look_into`+`shared` suggestion (should be visible to them, invisible to the other), one `new` suggestion (invisible to both), one `look_into`+`private_parent` suggestion (invisible to both — visibility overrides state). Plus one row in each AC-5 zero-row table (seeded as postgres where client writes are trigger-only or service-role-only).
  - [ ] Assertions (AC-7): sibling A reading `shidduchim` as `single` gets exactly her own visible suggestion, zero of her sibling's, zero of the `new`/`private_parent` ones. Repeat as sibling B.
  - [ ] Assertions (AC-2): as sibling A, her own-resume row (`single_id` set) is readable; sibling B's own-resume row is not.
  - [ ] Assertions (AC-5/7): as either single, `select count(*)` from each of the eight zero-row tables returns `0`; `select count(*) from public.account_members` returns exactly the caller's own row count (1), while the parent's session (re-asserted in the same test) sees the full roster.
  - [ ] Assertion (AC-4): as a single, `select` on `accounts` returns the household row; `update public.accounts set name = 'x'` and `delete from public.accounts` each affect zero rows / raise.
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
household. Without the `member_id` join in Task 2/3/4, a single with a login
would see every sibling's pipeline too — which is not "the same views as the
parent, filtered," it is the parent's own unfiltered view. Decided here, not
deferred, per the epic's own "no unresolved decisions" instruction.

### The own-resume decision

Story 5.8 gives a single's record its own outbound resume
(`resumes.single_id`). That resume describes the single themselves and is
circulated on their behalf; it contains no candid third-party content, so
withholding it would over-restrict without protecting anything. AC-2 grants
it. `resume_photos` stays denied — Story 5.4 decided and tested that
separately; this story does not reverse it.

### The NULL trap this story avoids

`current_member_role()` returns `NULL` when the caller has no active
membership (fail-closed, mirroring `current_context_id()`). The natural
instinct for "every role except single" is `current_member_role() IS
DISTINCT FROM 'single'` — but `NULL IS DISTINCT FROM 'single'` evaluates to
**`true`**, which would grant the broadened policies to a caller with *no*
role at all. Plain `<>` returns `NULL` (falsy in a `USING` clause) for that
case, so it fails closed the way every other predicate in this schema does.
Use `<>` everywhere in this story, never `IS DISTINCT FROM`, for the "not
single" direction.

### The two-policy pattern, and why it is not a rewrite of the existing policy

Every table this story touches keeps its existing policy byte-for-byte except
for one added clause (`and public.current_member_role() <> 'single'`) —
AC-6's regression requirement. The new `single`-scoped behaviour is
**additive**: a second, `SELECT`-only, `single`-scoped policy. Postgres
OR-combines permissive policies per command, so a `parent_admin` caller (for
whom the new clause on the old policy is trivially true) is unaffected, and a
`single` caller (for whom the old policy's new clause is now false) falls
through to seeing only what the new policy grants. The two deviations from
the blanket pattern are deliberate: `accounts` (Task 5 — the role guard must
not touch `SELECT`, or the context switcher breaks) and `account_members`
(Task 6 — the guard wraps only the roster branch, or sign-in-time membership
resolution through `my_contexts()` breaks for singles).

### What this story deliberately does not decide

- **`shadchanim`, `"references"`, `reference_links`, `interactions`,
  `entity_files`, `shidduchim_external_links`, `medical_notes`** — not
  touched here. All are **Story 6.3**'s, because the decision for each is
  about candid *content*, not *which rows exist*. Do not pre-empt 6.3.
- **`account_members` visibility for roles other than `single`** — e.g.
  whether a `helper` should see less than a `parent_admin` is a real, named
  gap, but no Epic 6 story asks for it; do not expand this story to cover it.
- **`visibility = 'private_child'`** — the check constraint admits it, but no
  Phase-1 story creates such rows or defines who sees them; a
  `private_child` suggestion is invisible to its single under AC-1's
  `'shared'` test, which matches the epic text exactly. If a later story
  gives `private_child` semantics, that story owns the policy change.

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
- `supabase/schemas/02_functions.sql` (one new function)
- `supabase/schemas/05_policies.sql` (policy edits across 14 tables: `shidduchim`, `resumes`, `shidduch_schools`, `singles`, `accounts`, `account_members`, `tasks`, `invites`, `date_records`, `redts`, `identity_signals`, `inbox_items`, `subscription`, `ai_usage`)
- `supabase/schemas/06_grants.sql` (one new function grant)
- `supabase/migrations/<timestamp>_single_role_row_scoping.sql` (generated + hand-checked)
- `supabase/tests/single_row_scoping.sql`, `supabase/tests/single_row_scoping.test.ts` (new)

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — exactly one scoping axis per row,
  deny-by-default.
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary
  (`parent_admin | single | helper | self_manager | shadchan`), active-context
  authorisation.
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_context_id()`, fail-closed
  NULL semantics.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — pipeline-state visibility is a single
  authority (`is_single_visible_state`, renamed from `is_child_visible_state`
  by story 1.3), never re-implemented per caller.
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md]
  — `current_member_id()` is defined there, once, and reused here (AC-8).
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md]
  — AC-7's `accounts`/`account_members` policy shapes this story narrows
  without breaking, and AC-8's partial unique index on active memberships.
- [Source: _bmad-output/implementation-artifacts/5-8-single-360.md] — the
  `resumes.single_id` own-resume shape covered by AC-2.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
  — shape 5, "singles with their own logins," is the scenario this story's
  negative test proves.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-6-The-Singles-Access]
  — Story 6.2's literal AC text.
- Current schema (pre-Epic-1 names, translated throughout this story to their
  post-1.3 equivalents): `supabase/schemas/01_tables.sql`,
  `supabase/schemas/05_policies.sql`, `supabase/schemas/02_functions.sql`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
