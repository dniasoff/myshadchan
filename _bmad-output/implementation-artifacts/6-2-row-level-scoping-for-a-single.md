# Story 6.2: Row-level scoping for a single

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want a single to see only the rows they should, enforced in Postgres,
so that privacy is structural, not a UI convention that a modified client
could bypass.

## Position in Epic 6

**2nd of 6 to build, and the first that touches the domain schema.** Epic 6's
delivery order is pinned, exactly as Epic 1's was, and for the same reason:
numbering follows the user's story (join → see → understand what's hidden →
speak → self-manage), build order follows what is safe to expose.

**Binding delivery order: 6.6 → 6.2 → 6.3 → 6.4 → 6.1 → 6.5.**

1. **6.6 first.** It refreshes `make check-migration-safety`'s fixture, which
   is pre-Epic-5 and will fail on the first Epic 6 migration — i.e. on *this*
   story's. It also adds the retry the deploy pipeline's mailer step lacks.
   Nothing in 6.6 touches `src/` or `supabase/schemas/`.
2. **6.2 (this story) second.** It introduces the `single` role's
   row-visibility rules and the one new helper function every later Epic 6
   story calls. Nothing about a real single login exists yet when this story
   lands — it is built and tested with directly-inserted `account_members`
   rows (the technique every suite in `supabase/tests/` already uses), never
   through a live invite.
3. **6.3 before 6.4.** 6.3 puts `interactions` into "deny the single role by
   default." 6.4 then carves the one exception (`single_input`) into that
   default. Building 6.4 first would mean writing the exception before the
   rule it is an exception to.
4. **6.1 after 6.2/6.3/6.4.** 6.1 is the story that produces a **real**
   `account_members` row with `role = 'single'` bound to a live login. If 6.1
   landed before the scoping in 6.2–6.4, a real single's first sign-in would
   land on the unrestricted, pre-Epic-6 policies (full account read) for
   however long the gap lasted. Building the fence before opening the gate.
5. **6.5 last.** It is a parity/regression guard over 6.2–6.4 (proving
   `self_manager` is *not* caught by any of this story's `= 'single'`
   predicates) plus an onboarding copy audit — there is nothing for it to
   guard until 6.2–6.4 exist.

## Acceptance Criteria

1. **A single sees a suggestion only when three things are simultaneously
   true:** it belongs to their own `singles` row (not a sibling's), its
   `visibility` is `'shared'`, and its `pipeline_state` is one of the three
   single-visible states. `public.is_single_visible_state()`
   (`02_functions.sql:1367`) is the one authority for the third — it is a
   closed enumeration over all seven states (`look_into`/`yes`/`unsure` true;
   `new`/`not_sure`/`for_sure_not`/`no` false) that **raises** on an
   unclassified value, and it takes `public.pipeline_state`, not `text`. A
   suggestion missing any one of the three is invisible to them — the epic's
   "gut set-asides and rejected suggestions are absent" plus the un-stated but
   architecturally required sibling exclusion (see Dev Notes "Why sibling
   exclusion is this story's, not an invention").

2. **The single sees their own resume-adjacent facts** — `resumes` and
   `shidduch_schools` rows tied to a suggestion that passes AC-1 are readable,
   and so is the single's **own outbound resume** (`resumes.single_id` set,
   `shidduchim_id` null — the Story 5.8 shape, enforced by
   `resumes_owner_check`, `01_tables.sql:412`). Rows tied to any other
   suggestion, to a sibling's suggestion, or to a sibling's own resume are
   not.

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
   content), and `resume_photos`, whose `single`-awareness Story 5.4 already
   shipped and which this story must not disturb (see AC-9).

6. **A single cannot reach a denied row through an RPC either.** Every
   domain function on the `authenticated` grant list — `create_shidduch`,
   `transition_shidduch`, `catch_shidduch`, `add_redt`, `add_school`,
   `add_resume_file`, `add_resume_photo`, `hide_resume_photo`,
   `log_reference_call`, `link_reference_to_shidduch`,
   `match_reference_on_entry`, `merge_references` — is **SECURITY INVOKER**
   (verified at HEAD: none carries `SECURITY DEFINER`), so the policies this
   story writes apply inside them. That is a property, not an accident, and
   this story pins it with a test: a `single` caller gets a raised exception
   or zero affected rows from each of them. Any future definer-ised domain
   RPC would silently bypass every policy here.

7. **None of the above touches any role other than `single`.** A
   `parent_admin`, `helper` or `self_manager` member's access is byte-for-byte
   unchanged — same rows, same commands, before and after this story's
   migration. Proven by re-running the existing account-isolation assertions
   in `references_entity.sql`, `shidduch_catch.sql`, `context_rls_hardening.sql`,
   `resume_photos.sql` and `medical_notes.sql` unmodified and green.

8. **Negative test, required by `.claude/rules/security-triggers.md`:** two
   singles in the **same household** (siblings), each with their own
   `account_members` row and `singles` row; a suggestion visible to sibling A
   returns zero rows when queried as sibling B, and vice versa. A second
   negative test proves a `single` role member gets zero rows from each
   zero-row table in AC-5, and only their own row from `account_members`, in
   the same account, in the same test run.

9. **Role resolution is single-owner, and the two policies that already ask
   the question are moved onto it.** Exactly one new function resolves "what
   role does the caller hold in their active context"
   (`current_member_role()`), derived from `current_member_id()`
   (`02_functions.sql:242`), which this story **reuses and must not
   redefine**. Two shipped policies currently inline the same lookup — the
   `resume_photos` policy (`05_policies.sql:226`) and the `medical_notes`
   policy (`:267`), both written as
   `exists (select 1 from public.account_members am where am.id =
   public.current_member_id() and am.role …)`. Both are rewritten in terms of
   `current_member_role()` in this story's migration. The rewrite is
   **behaviour-preserving** (`current_member_role()` returns NULL for a
   caller with no active membership, and `NULL <> 'single'` is NULL, i.e.
   falsy — exactly what the `exists` returned), and `resume_photos.sql` /
   `medical_notes.sql` must pass unmodified afterwards. No policy
   re-implements either lookup inline after this story.

10. **The tabs whose data this story empties are hidden from a single, not
    left as empty shells.** Permission-aware rendering shipped in Story 3.4
    and is live: `EntityTabDescriptor.visibleTo?: MemberRole[]` (an
    allow-list; absent = every role) filtered by
    `entity360/visibility.ts`'s `hasVisibility()` before the array reaches
    `Entity360Tabs`, so a denied tab's `render` is never called. This story
    is one of its two heaviest consumers and uses it rather than inventing a
    second mechanism: the `tasks` tab on all four 360s gains
    `visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"]`
    (there is no "hide from" form — `visibleTo` is an allow-list, so
    excluding one role means naming the other four). `tabs ∪ pendingTabs` is
    unchanged, so `CANONICAL_TAB_SETS` needs no amendment and the AD-24
    validator stays quiet.

## Tasks / Subtasks

- [ ] **Task 0 — Reuse check, before writing anything** (AC: 9)
  - [ ] Verified for this refresh, re-verify at implementation time:
        `current_member_id()` exists (`02_functions.sql:242`, SECURITY
        DEFINER, granted to `authenticated`/`service_role` at
        `06_grants.sql:248-250`); `current_context_id()` exists (`:201`);
        `current_member_role()` does **not** exist anywhere; there is no
        `is_single()` helper. Confirm with
        `grep -rniE "current_member_role|is_single\(" supabase/schemas/*.sql`.
        If a role-resolution equivalent has landed under another name since,
        reuse it under its existing name and skip Task 1's function half.
  - [ ] `account_members_role_check` already admits `'single'`
        (`01_tables.sql:210-212`, Story 2.2 AC-2) — verified. No constraint
        change in this story.

- [ ] **Task 1 — Add `current_member_role()`** (AC: 9)
  - [ ] `supabase/schemas/02_functions.sql`, colocated immediately after
    `current_member_id()`:
    ```sql
    -- The single authority for "what role does the caller hold in their
    -- active context" (AD-2). Derived from current_member_id() (defined
    -- above, once) so the membership-row resolution stays single-owner.
    -- SECURITY DEFINER so RLS policies can call it without recursing into
    -- account_members' own policies (the same reason current_context_id()
    -- and current_member_id() are SECURITY DEFINER).
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
        ... to authenticated, service_role;` — mirror the
        `current_member_id()` grant block at `:245-250` exactly.

- [ ] **Task 2 — Split the `shidduchim` policy: full access for everyone except `single`, narrow read for `single`** (AC: 1)
  - [ ] In `supabase/schemas/05_policies.sql:201`, add
        `and public.current_member_role() <> 'single'` to both the `using`
        and `with check` of `"Shidduchim scoped to account"`. This is the one
        line that stops the pre-existing blanket policy from granting a
        single role full CRUD.
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
    `shidduchim_visibility_check` admits `'shared'`, `'private_parent'` and
    `'private_single'` (`01_tables.sql:385-387`) — the `= 'shared'` test
    excludes the other two, which is what the epic text requires.

- [ ] **Task 3 — Same split for `resumes` and `shidduch_schools`** (AC: 2)
  - [ ] Add `and public.current_member_role() <> 'single'` to each table's
        existing `for all` policy (`05_policies.sql:206`, `:301`).
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
  - [ ] `resumes`: the same policy plus the own-resume branch. `single_id`
        exists and `resumes_owner_check` guarantees exactly one of
        `shidduchim_id`/`single_id` is set, so the two branches are
        mutually exclusive by construction:
    ```sql
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and (
            exists (  -- a visible suggestion's resume
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
  - [ ] Add `and public.current_member_role() <> 'single'` to
        `"Singles scoped to account"` (`05_policies.sql:186`), both halves.
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
  - [ ] `"Account access scoped to member"` (`05_policies.sql:89`) is a
        `for all` policy whose `using`/`with check` is a membership `exists`
        lookup (so the context switcher can read non-active contexts). A
        blanket `<> 'single'` on its `using` would break the switcher, the
        app shell, and `my_contexts()` — which is SECURITY **INVOKER**
        (`02_functions.sql:379`) and joins `accounts`. Instead, **split it
        per command**, preserving the membership lookup verbatim in both:
    - `"Accounts readable to their members"` — `for select`, the existing
      membership-`exists` predicate, **no role guard**.
    - `"Accounts writable by non-single members"` — `for insert, update,
      delete`, the existing membership-`exists` predicate `and
      public.current_member_role() <> 'single'` in **both** `using` and
      `with check` (the `using` half is what stops a single's `DELETE`, which
      never consults `with check`).
  - [ ] This split changes nothing for any other role (AC-7): the OR of the
        two policies reproduces the old policy exactly when the role guard
        passes.

- [ ] **Task 6 — Deny for `single` on the remaining tables with no stated Epic 6 use** (AC: 5)
  - [ ] For each of `tasks` (`:35`), `date_records` (`:291`), `redts`
        (`:296`) and `inbox_items` (`:650`) — all `for all` policies — add
        `and public.current_member_role() <> 'single'` to both `using` and
        `with check`.
  - [ ] `invites` (`:182`), `identity_signals` (`:621`), `subscription`
        (`:636`) and `ai_usage` (`:640`) are **SELECT-only policies with no
        `with check`** — add the clause to `using` only. Note in particular
        that `invites` has no insert/update/delete policy and
        `06_grants.sql:119-121` withholds DML from `authenticated` entirely,
        so there is no PostgREST insert surface for this story to close on
        that table; the edit narrows reads only.
  - [ ] Use `<>`, not `is distinct from` — see Dev Notes "The NULL trap this
        story avoids".
  - [ ] `account_members` is the one special case, and its shape is **not** a
        single `for all` policy. Post-2.1 hardening it carries three
        per-command policies (`05_policies.sql:148-161`) and **no UPDATE
        policy at all** (UPDATE is withheld at the grant layer,
        `06_grants.sql:627`):
    - `"Account members readable by owner or within active account"`
      (SELECT, `using (user_id = auth.uid() or account_id =
      public.current_context_id())`) — guard **only the roster branch**,
      keeping the own-rows branch, which `my_contexts()` (SECURITY INVOKER)
      and therefore `useViewerRole()`, the context switcher and sign-in all
      depend on:
      ```sql
      using (
          user_id = auth.uid()
          or (account_id = public.current_context_id()
              and public.current_member_role() <> 'single')
      )
      ```
      There is no `with check` on this policy to mirror.
    - `"Account members insertable within active account"` (INSERT,
      `with check (account_id = public.current_context_id())`) — add
      `and public.current_member_role() <> 'single'`.
    - `"Account members deletable within active account"` (DELETE,
      `using (account_id = public.current_context_id())`) — add
      `and public.current_member_role() <> 'single'`.
    - Do **not** add a `for update` policy while here. Its absence is
      load-bearing (Story 2.2 review finding #1's fix).
  - [ ] One-line reason per table, to go in the schema comment beside each edited policy:
    - `account_members` (roster branch) — the household roster and its `invited_by`/`status` chain; no Epic 6 story needs a single to browse it. Own rows stay: sign-in and context resolution need them.
    - `tasks` — the family's follow-through work (CAP-6); free-text `text` routinely names candid diligence steps.
    - `invites` — membership management is an owning-role concern (`is_invite_capable_role()` already refuses a `single` caller inside `create_invite()`); this narrows the read surface to match.
    - `date_records` — dating history `notes` is free-text and unaudited for candour.
    - `redts` — the redt history's own `note` field is shadchan/parent commentary.
    - `identity_signals` — internal match-key store; spans **every** matchable entity in the household (not `singles`-row-scoped), so a naive read would leak cross-sibling signals.
    - `inbox_items` — raw, pre-confirm captures; the least triaged, most candid layer in the product (AD-6).
    - `subscription`, `ai_usage` — billing/entitlement; household-owner business.
  - [ ] **Completeness sweep** — the classification below was verified against
        the schema at HEAD (22 relations carry `account_id`, plus `accounts`
        itself). Re-verify rather than trusting it:
    ```sql
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'account_id'
    where n.nspname = 'public' and c.relkind = 'r' order by 1;
    ```
    Every table returned must be classified exactly once: this story's allow
    set (`shidduchim`, `resumes`, `shidduch_schools`, `singles`,
    `account_members`; plus `accounts` itself), this story's deny set
    (`tasks`, `invites`, `date_records`, `redts`, `identity_signals`,
    `inbox_items`, `subscription`, `ai_usage`), Story 6.3's set
    (`shadchanim`, `"references"`, `reference_links`, `interactions`,
    `entity_files`, `shidduchim_external_links`, `medical_notes`), or
    `resume_photos` (Story 5.4's, already role-aware). An unclassified table
    is a blocker, not a silent pass-through. (Non-`account_id` relations —
    `members`, `member_state`, `pipeline_transitions`, `configuration` — are
    outside this epic's axis: the first two are user-scoped and Epic 2's, the
    last two are global reference data.)

- [ ] **Task 7 — Fold the two inlined role lookups onto `current_member_role()`** (AC: 9)
  - [ ] `resume_photos` (`05_policies.sql:226`): replace both occurrences of
        `exists (select 1 from public.account_members am where am.id =
        public.current_member_id() and am.role <> 'single')` with
        `public.current_member_role() <> 'single'`. Keep the surrounding
        `visibility = 'shared' or …` structure exactly — **this policy
        deliberately lets a `single` read `shared` photos**, and this story
        does not change that.
  - [ ] `medical_notes` (`05_policies.sql:267`): replace both occurrences of
        `exists (… and am.role in ('parent_admin', 'self_manager'))` with
        `public.current_member_role() in ('parent_admin', 'self_manager')`.
  - [ ] Update both policies' comment blocks, which currently explain the
        `exists (… am.id = current_member_id() …)` idiom by name.
  - [ ] `supabase/tests/resume_photos.sql` and
        `supabase/tests/medical_notes.sql` must pass **unmodified**. If
        either needs an edit, the rewrite was not behaviour-preserving —
        stop and reconsider, do not adjust the test.

- [ ] **Task 8 — Hide the emptied Tasks tab from a single** (AC: 10)
  - [ ] Add `visibleTo: ["parent_admin", "self_manager", "helper",
        "shadchan"]` to the `{ key: "tasks", … }` descriptor entry in all
        four of `shidduchim/entityDescriptor.tsx`,
        `singles/entityDescriptor.tsx`, `shadchanim/entityDescriptor.tsx`
        and `references/entityDescriptor.tsx`, each with a one-line comment
        citing this story.
  - [ ] Do **not** touch `pendingTabs` (all four are `[]`) or
        `CANONICAL_TAB_SETS` — `visibleTo` is orthogonal to the
        `tabs ∪ pendingTabs` set the AD-24 validator checks. Run
        `npx vitest run src/components/atomic-crm/entity360/ad24Conformance`
        to confirm the validator stays quiet.
  - [ ] `TasksRailSummary` on the shidduch right rail reads `tasks` too; a
        single gets an empty summary there. That is acceptable and
        deliberate — Ruling 2 keeps the rail read-only and this story does
        not add role branching to it; the empty state is the correct render.
        Assert it in the existing rail test rather than adding a guard.

- [ ] **Task 9 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f single_role_row_scoping`
  - [ ] Confirm the diff contains only `CREATE FUNCTION`, `DROP POLICY` +
        `CREATE POLICY` and `ALTER POLICY` statements — no `DROP TABLE` /
        `CREATE TABLE` and no `DROP VIEW` (this story renames nothing and
        touches no view; a `DROP VIEW` in the diff means the declarative
        column order drifted — see the COLUMN-ORDER TRAP at the top of
        `01_tables.sql`). Re-issue the Task 1 function grant by hand if the
        diff omits it (`db diff` does not re-emit function grants).
  - [ ] `make check-migration-safety`. This story drops no column and deletes
        no row, so it must pass with no new `declared-moves.sql` entry. A
        failure here is either a real defect or 6.6 not having landed.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        Never `db reset --local`, never `db push`.

- [ ] **Task 10 — Tests** (AC: 6, 7, 8)
  - [ ] New `supabase/tests/single_row_scoping.sql` + `.test.ts` pair, same
        shape as `references_entity.sql`/`.test.ts` (temp `results`/`ids`
        tables, `set local request.jwt.claims`, roll back at the end).
        Arrange: one household account, one `parent_admin`, two
        `single`-role `account_members` rows each linked via `member_id` to
        their own `singles` row (siblings "Leah" and "Rivka"), and for each
        sibling: one `look_into`+`shared` suggestion (visible to them,
        invisible to the other), one `new` suggestion (invisible to both),
        one `look_into`+`private_parent` suggestion (invisible to both —
        visibility overrides state). Plus one row in each AC-5 zero-row table
        (seeded as `postgres` where client writes are trigger-only or
        service-role-only).
  - [ ] `shidduchim` inserts must go through `public.create_shidduch()` or be
        seeded as `postgres` — `enforce_shidduch_initial_state` and
        `enforce_pipeline_transition` gate raw writes. Follow
        `shidduch_catch.sql`'s arrangement rather than inventing one.
  - [ ] Assertions (AC-8): sibling A reading `shidduchim` as `single` gets
        exactly her own visible suggestion, zero of her sibling's, zero of
        the `new`/`private_parent` ones. Repeat as sibling B.
  - [ ] Assertions (AC-2): as sibling A, her own-resume row (`single_id`
        set) is readable; sibling B's own-resume row is not; the resume of
        her own `new` suggestion is not.
  - [ ] Assertions (AC-5/8): as either single, `select count(*)` from each of
        the eight zero-row tables returns `0`; `select count(*) from
        public.account_members` returns exactly the caller's own row count
        (1), while the parent's session (re-asserted in the same test) sees
        the full roster.
  - [ ] Assertion (AC-4): as a single, `select` on `accounts` returns the
        household row and `select * from public.my_contexts()` returns their
        one context with `role = 'single'`; `update public.accounts set name
        = 'x'` and `delete from public.accounts` each affect zero rows.
  - [ ] Assertions (AC-6): as a single, each of `transition_shidduch`,
        `catch_shidduch`, `add_redt`, `add_school`, `create_shidduch`,
        `add_resume_file` and `link_reference_to_shidduch` raises or affects
        zero rows on a row the single can otherwise see; and
        `create_invite('x@y.z','single')` raises `role single may not send
        invites`. Structure each as its own `insert into results` row so a
        future definer-isation of any one of them fails a named assertion.
  - [ ] Assertion (AC-7, regression guard): re-run `npm run test:unit:db` in
        full. `references_entity.sql`, `shidduch_catch.sql`,
        `context_rls_hardening.sql`, `resume_photos.sql`, `medical_notes.sql`,
        `context_resolution.sql`, `invites.sql`, `household_scope_lift.sql`
        and `security_invoker_views.sql` must all pass **unmodified**.
  - [ ] Frontend: `make test` must stay green, and the four descriptor tests
        gain an assertion that the `tasks` tab is absent for a `single`
        viewer and present for a `parent_admin` (`vitest-browser-react` +
        `TestMemoryRouter`; the `EntityShow.permissions.test.tsx` pattern
        already exists for exactly this).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`
        (the DB suites need `make start`).

## Dev Notes

### Why sibling exclusion is this story's, not an invention

The epic's literal AC-6.2 wording ("they see only shared suggestions in
child-visible states") does not spell out the sibling case, but the glossary
is explicit that a `single` is "the person being redt for... your own child,
**or yourself**" — the dignity floor is about *my own* process. Every family
shape in `personas-and-contexts.md` that includes "singles with their own
logins" (shape 5) is built on top of shapes with multiple `singles` rows per
household. Without the `member_id` join in Tasks 2/3/4, a single with a login
would see every sibling's pipeline too — which is not "the same views as the
parent, filtered," it is the parent's own unfiltered view. Decided here, not
deferred, per the epic's own "no unresolved decisions" instruction.

### The own-resume decision

Story 5.8 gives a single's record its own outbound resume
(`resumes.single_id`). That resume describes the single themselves and is
circulated on their behalf; it contains no candid third-party content, so
withholding it would over-restrict without protecting anything. AC-2 grants
it.

### `resume_photos` is not a deny — read Story 5.4 before touching it

An earlier draft of this story described `resume_photos` as "already denies
`single` with its own negative test." That is wrong, and repeating it would
have caused a real regression. Story 5.4 shipped a *narrowing*, not a deny:
the policy grants a `single` every `visibility = 'shared'` photo and denies
only `private_parent` ones (`05_policies.sql:226-244`), and the matching
storage policy does the same on the object key's third path segment
(`07_storage.sql:174-188`). Task 7 rewrites the *expression* of that check
onto `current_member_role()`; it must not change the *answer*. The same
correction applies to Story 6.3's storage task.

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
AC-7's regression requirement. The new `single`-scoped behaviour is
**additive**: a second, `SELECT`-only, `single`-scoped policy. Postgres
OR-combines permissive policies per command, so a `parent_admin` caller (for
whom the new clause on the old policy is trivially true) is unaffected, and a
`single` caller (for whom the old policy's new clause is now false) falls
through to seeing only what the new policy grants. The two deviations from
the blanket pattern are deliberate: `accounts` (Task 5 — the role guard must
not touch `SELECT`, or `my_contexts()` and the switcher break) and
`account_members` (Task 6 — the guard wraps only the roster branch, for the
same reason, and there are three policies to edit rather than one).

### RPCs are the other half of the fence

RLS only helps if the code paths that write these tables run under invoker
rights. At HEAD they do: every domain RPC granted to `authenticated` is
plain `LANGUAGE plpgsql` with no `SECURITY DEFINER`, and the definer
functions that exist (`current_context_id`, `current_member_id`,
`set_active_context`, `add_persona`, `remove_persona`, `create_invite`,
`accept_invite`, `get_invite_preview`, `check_signup_invite`) each carry
their own caller check. AC-6's tests exist so that this stays true by
assertion rather than by inspection — a future story that reaches for
`SECURITY DEFINER` to "make an RPC work" would otherwise punch a hole
through every policy in this file with nothing going red.

### What this story deliberately does not decide

- **`shadchanim`, `"references"`, `reference_links`, `interactions`,
  `entity_files`, `shidduchim_external_links`, `medical_notes`** — not
  touched here. All are **Story 6.3**'s, because the decision for each is
  about candid *content*, not *which rows exist*. Do not pre-empt 6.3.
- **`account_members` visibility for roles other than `single`** — e.g.
  whether a `helper` should see less than a `parent_admin` is a real, named
  gap, but no Epic 6 story asks for it; do not expand this story to cover it.
- **`visibility = 'private_single'`** — `shidduchim_visibility_check` admits
  it (`01_tables.sql:385-387`; it is `private_single` post-1.3, never
  `private_child`), but no Phase-1 story creates such rows or defines who
  sees them. A `private_single` suggestion is invisible to its single under
  AC-1's `'shared'` test, which matches the epic text exactly. If a later
  story gives `private_single` semantics, that story owns the policy change.

### Testing standard

SQL suites in this repo are plain scripts, not pgTAP: a `results` temp table
accumulates `(name, passed, detail)` rows inside a single rolled-back
transaction, and a matching `*.test.ts` loads the file, runs it via
`execFileSync`/psql against `SUPABASE_DB_URL`
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres` by default), and
turns each row into a named Vitest assertion — see
`supabase/tests/references_entity.sql` + `.test.ts` for the exact shape to
copy, and `supabase/tests/dbSuiteHelpers.ts` for the shared harness.
Multi-user scenarios switch identity with
`set local role authenticated; set local request.jwt.claims =
'{"sub":"<uuid>","role":"authenticated"}';` — never a real Supabase Auth
session. Supabase CLI calls need `DBUS_SESSION_BUS_ADDRESS=/dev/null`. AAA
structure per `.claude/rules/testing.md`.

### Project Structure Notes — the true file set

Schema / DB:
- `supabase/schemas/02_functions.sql` (one new function)
- `supabase/schemas/05_policies.sql` (policy edits on `shidduchim`,
  `resumes`, `shidduch_schools`, `singles`, `accounts` (split into two),
  `account_members` (three policies), `tasks`, `invites`, `date_records`,
  `redts`, `identity_signals`, `inbox_items`, `subscription`, `ai_usage`,
  plus the two DRY rewrites on `resume_photos` and `medical_notes`)
- `supabase/schemas/06_grants.sql` (one new function grant)
- `supabase/migrations/<timestamp>_single_role_row_scoping.sql` (generated +
  hand-checked)
- `supabase/tests/single_row_scoping.sql`, `single_row_scoping.test.ts` (new)
- `supabase/tests/dbSuiteHelpers.ts` (if the sibling fixture is factored for
  reuse by 6.3/6.4/6.1/6.5 — likely, and preferable to four copies)
- Regression-only, must not be edited: `references_entity.sql`,
  `shidduch_catch.sql`, `context_rls_hardening.sql`, `resume_photos.sql`,
  `medical_notes.sql`, `context_resolution.sql`, `invites.sql`,
  `household_scope_lift.sql`, `security_invoker_views.sql`, `view_grants.sql`

Frontend (AC-10 only):
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` + `.test.tsx`
- `src/components/atomic-crm/singles/entityDescriptor.tsx` + `.test.tsx`
- `src/components/atomic-crm/shadchanim/entityDescriptor.tsx` + `.test.tsx`
- `src/components/atomic-crm/references/entityDescriptor.tsx` + `.test.tsx`
- `src/components/atomic-crm/entity360/ad24Conformance.test.ts` (must stay
  green; no `CANONICAL_TAB_SETS` edit)
- `registry.json` (no new files expected, so likely unchanged — but the
  pre-commit hook regenerates it; commit whatever it produces)

No new i18n keys are expected in this story (`visibleTo` hides a tab whose
label already exists). If any string is added, both
`providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` change.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] — exactly one scoping axis per row,
  deny-by-default.
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary
  (`parent_admin | single | helper | self_manager | shadchan`), active-context
  authorisation.
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_context_id()`, fail-closed
  NULL semantics.
- [Source: ARCHITECTURE-SPINE.md#AD-3] — pipeline-state visibility is a single
  authority (`is_single_visible_state`), never re-implemented per caller.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2] — rule 7:
  `visibleTo?: MemberRole[]`, absent = visible to every role; there is no
  `minVisibility`.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#6] — rule 2:
  filtering happens before the array reaches `Entity360Tabs`; a denied tab's
  `render` is never called.
- [Source: _bmad-output/implementation-artifacts/3-4-permission-aware-rendering.md]
  — `useViewerRole`, `hasVisibility`, `canAccess.ts` on `MemberRole`.
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md]
  — AC-7's `accounts`/`account_members` policy shapes this story narrows
  without breaking, and AC-8's partial unique index on active memberships.
- [Source: _bmad-output/implementation-artifacts/5-4-photo-tab-explicit-visibility.md]
  — the `resume_photos` narrowing this story rewrites but must not reverse.
- [Source: _bmad-output/implementation-artifacts/5-8-single-360.md] — the
  `resumes.single_id` own-resume shape covered by AC-2.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
  — shape 5, "singles with their own logins," is the scenario AC-8 proves.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-6-The-Singles-Access]
  — Story 6.2's literal AC text.
- Current schema, all line numbers verified for this refresh:
  `supabase/schemas/01_tables.sql:210-212` (`account_members_role_check`),
  `:385-387` (`shidduchim_visibility_check`), `:412` (`resumes_owner_check`);
  `supabase/schemas/02_functions.sql:201` (`current_context_id`), `:242`
  (`current_member_id`), `:379` (`my_contexts`, SECURITY INVOKER), `:1367`
  (`is_single_visible_state`); `supabase/schemas/05_policies.sql` (every
  policy line cited inline above); `supabase/schemas/06_grants.sql:245-250`,
  `:627`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
