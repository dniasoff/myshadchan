---
baseline_commit: c711266817905ef90afaecae26b7f370c8c6d30a
---

# Story 2.1: Context-Aware Authorisation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want authorisation to derive from an explicit, server-held active context,
so that a user who holds several contexts sees exactly the one they chose — never
whichever one a query happens to pick first.

## Position in Epic 2 — first, load-bearing for every other story

This is **the blocker** (epics.md's own word for it): epics.md states plainly that
"personas and contexts are unbuildable until it is rewritten." Every other story in
this epic, and every RLS-touching story after it, calls `current_context_id()` and
assumes `member_state` / `set_active_context()` exist. Nothing in 2.2–2.8 can start
until this lands.

**Re-verified against the post-Epic-1 tree** (`main` @ `c711266`, 2026-07-28). Epic 1
(1.1–1.6) is merged and deployed: `sales` is now `members`, `children` is `singles`,
the seven fork fossil tables and the token portal are gone, and route/resource
registration is `src/components/atomic-crm/root/routeManifest.ts` rather than hand-written
`<Resource>`/`<Route>` JSX. Every line number, object name, policy name and count below
was re-read from the tree at that commit — not carried forward from the pre-Epic-1 draft.
Line numbers are still a convenience, not the contract: the named object and the stated
count are what decide each AC.

## Acceptance Criteria

1. **The resolver is context-aware, not first-row.** `public.current_account_id()`
   (`supabase/schemas/02_functions.sql:146-162` today — `order by am.id limit 1` at
   `:157-158`) is **deleted**, not deprecated or wrapped.
   `select to_regproc('public.current_account_id')` returns NULL after migration.

2. **A new function replaces it with the same call shape, a different source of truth.**
   `public.current_context_id() returns bigint`, `STABLE`, `SECURITY DEFINER`,
   `SET search_path TO ''`. It returns `member_state.active_account_id` for the caller
   **only if** that value is still a live `active`-status row in `account_members`
   (`user_id = auth.uid()`, `account_id = active_account_id`, `status = 'active'`);
   otherwise NULL. No `order by … limit 1`, no "first account", no fallback of any kind
   survives anywhere in the schema (AD-19).

3. **The active context is a real, server-held row.** A new table
   `public.member_state(user_id uuid primary key references auth.users(id) on delete
   cascade, active_account_id bigint references public.accounts(id) on delete set null,
   updated_at timestamptz not null default now())`. AD-19 names the table and its two
   load-bearing columns verbatim (`member_state(user_id, active_account_id)`);
   `updated_at` is this story's addition and carries no behaviour. RLS:
   a caller may `select` their own row; there is **no** `insert`/`update`/`delete`
   policy for `authenticated` at all, so the only way the row changes is through
   `set_active_context()` (`SECURITY DEFINER`, bypasses RLS internally). A negative
   test proves `update public.member_state set active_account_id = <other> where
   user_id = auth.uid()` fails for an ordinary authenticated client (`set local role
   authenticated;` + `set local request.jwt.claims = …`, the pattern at
   `supabase/tests/references_entity.sql:104-105`).

4. **Switching context is one validated function, not a raw write.**
   `public.set_active_context(p_account_id bigint) returns void`, `SECURITY DEFINER`,
   `SET search_path TO ''`. It raises (`no active membership of account %`) unless
   `exists (select 1 from public.account_members where user_id = auth.uid() and
   account_id = p_account_id and status = 'active')`; on success it upserts
   `member_state`. The physical upsert itself lives in **one** private helper —
   `public.activate_context_for(p_user_id uuid, p_account_id bigint)`, `SECURITY
   DEFINER`, EXECUTE revoked from every client role (`public`, `anon`,
   `authenticated`) — shared with AC-5's trigger, so `member_state` still has exactly
   one writer (AC-3 makes the alternative — a raw client UPDATE — impossible; AD-19:
   "Switching goes through **`set_active_context(account_id)`**, which validates
   membership before writing").

5. **A user's first context activates itself; gaining a second never silently moves
   them.** An `after insert` trigger on `public.account_members`
   (`activate_first_context()`) acts only when the inserted row is `active` and
   `new.user_id` has no `member_state` row yet, or its `active_account_id` no longer
   matches **any** of `new.user_id`'s active memberships (the same rule
   `current_context_id()` applies, expressed over `new.user_id`); when it acts, it
   calls AC-4's shared `activate_context_for(new.user_id, new.account_id)`. It must
   **not** call `set_active_context()`: memberships are also inserted by
   `handle_new_user()` (`02_functions.sql:25`, the first-user bootstrap; rewritten in
   2.7), which runs as an `auth.users` trigger where `auth.uid()` is NULL — a validation
   against `auth.uid()` there would raise and roll back the whole signup. The inserted
   row itself is the proof of membership; the trigger needs no second check. It must
   also tolerate `new.user_id is null` (`account_members.user_id` is nullable —
   `01_tables.sql:135`, `on delete set null`) by doing nothing. Adding a second context
   to a user who already has a working active one does nothing to `member_state` (this
   is what lets FR84's "never inferred" and 2.4's "a user with one context sees no
   switcher clutter" both hold from the moment a context exists, without a UI-side
   bootstrap step).

6. **Every RLS policy that reads the old resolver reads the new one — all 20,
   verified.** No table is missed and no table gets a second, divergent scoping
   expression. The complete list, by table and policy name, re-read from the tree at
   `c711266`. **17 live in `supabase/schemas/05_policies.sql`; 3 live in
   `supabase/schemas/07_storage.sql` and are the easiest to miss** (see the Dev Notes
   warning). 18 of the 20 get a literal `using`/`with check` token swap
   (`current_account_id()` → `current_context_id()`) with no other behavioural change;
   `accounts` and `account_members` each get AC-7's corrected shape instead of the
   literal swap:

   | # | File | Table | Policy | Occurrences |
   |---|---|---|---|---|
   | 1 | `05_policies.sql:51` | `accounts` | `Account access scoped to member` — **gets AC-7's shape fix** | 2 |
   | 2 | `05_policies.sql:58` | `account_members` | `Account members scoped to account` — **gets AC-7's shape fix** | 2 |
   | 3 | `05_policies.sql:63` | `singles` | `Singles scoped to account` | 2 |
   | 4 | `05_policies.sql:68` | `shadchanim` | `Shadchanim scoped to account` | 2 |
   | 5 | `05_policies.sql:73` | `references` | `References scoped to account` | 2 |
   | 6 | `05_policies.sql:78` | `shidduchim` | `Shidduchim scoped to account` | 2 |
   | 7 | `05_policies.sql:83` | `resumes` | `Resumes scoped to account` | 2 |
   | 8 | `05_policies.sql:88` | `reference_links` | `Reference links scoped to account` | 2 |
   | 9 | `05_policies.sql:93` | `date_records` | `Date records scoped to account` | 2 |
   | 10 | `05_policies.sql:98` | `redts` | `Redts scoped to account` | 2 |
   | 11 | `05_policies.sql:103` | `shidduch_schools` | `Shidduch schools scoped to account` | 2 |
   | 12 | `05_policies.sql:139` | `interactions` | `Interactions scoped to account and parent visibility` | **8** |
   | 13 | `05_policies.sql:198` | `identity_signals` | `Identity signals readable within account` | 1 |
   | 14 | `05_policies.sql:213` | `subscription` | `Subscription readable within account` | 1 |
   | 15 | `05_policies.sql:217` | `ai_usage` | `AI usage readable within account` | 1 |
   | 16 | `05_policies.sql:227` | `inbox_items` | `Inbox items scoped to account` | 2 |
   | 17 | `05_policies.sql:16` | `tasks` | `Tasks scoped to account` | 2 |
   | 18 | `07_storage.sql` | `storage.objects` | `Attachments readable within account` | 1 |
   | 19 | `07_storage.sql` | `storage.objects` | `Attachments writable within account` | 1 |
   | 20 | `07_storage.sql` | `storage.objects` | `Attachments deletable within account` | 1 |

   That is **37 policy-body occurrences in `05_policies.sql`** (+ 2 in that file's prose
   comments at `:30` and `:33`, AC-10's job) and **3 in `07_storage.sql`**. Decide with
   `grep -o current_account_id supabase/schemas/05_policies.sql | wc -l` → **39** today,
   **0** after; and the same over `07_storage.sql` → **3** today, **0** after.

   (`pipeline_transitions`'s `using (true)` (`05_policies.sql:110`) and `configuration`'s
   `is_admin()`-gated policies (`:22-24`) do not call the old resolver and are untouched —
   nothing to migrate. `members`'s own `using (true)` read policy (`:12`) likewise calls
   neither resolver; **it stays out of this story's scope on purpose** — see Dev Notes
   "What this story deliberately does not touch.")

7. **`accounts` and `account_members` each get the one shape correction the swap
   forces, not a copy-paste of the other 18.** A straight `= current_context_id()` swap
   on either table would make a user's own **non-active** context — and their own
   membership row in it — invisible to them. That breaks the context switcher (Story
   2.4) before it is even built: switching contexts requires reading the name/kind of a
   context you are *not* currently active in, to render it as a switch target.
   `account_members`'s corrected policy:
   ```sql
   using (
     user_id = auth.uid()
     or account_id = public.current_context_id()
   )
   with check (
     user_id = auth.uid()
     or account_id = public.current_context_id()
   )
   ```
   A caller always sees their **own** membership rows (every context they belong to),
   plus **other** members' rows only inside the context they are currently active in.
   `accounts`'s corrected policy (no `user_id` column exists on `accounts` itself, so
   the check is a membership lookup rather than a direct comparison):
   ```sql
   using (
     exists (
       select 1 from public.account_members am
       where am.account_id = accounts.id
         and am.user_id = auth.uid()
         and am.status = 'active'
     )
   )
   with check (
     exists (
       select 1 from public.account_members am
       where am.account_id = accounts.id
         and am.user_id = auth.uid()
         and am.status = 'active'
     )
   )
   ```
   This is a strict superset of "the currently active one" (every account you hold live
   membership in, active or not), never a subset. A negative test proves a caller
   cannot read a **different** user's membership row, nor a **third** account they hold
   no membership in at all, whether or not either is the caller's active context.

8. **A duplicate active membership in the same context is now a schema error, not a
   silent ambiguity.** `create unique index account_members_account_user_active_uq on
   public.account_members (account_id, user_id) where status = 'active';` — the exact
   class of ambiguity `order by am.id limit 1` was originally covering for cannot recur
   even by accident. Before adding it, confirm the local database has no existing
   violation (`select account_id, user_id, count(*) from public.account_members where
   status = 'active' group by 1,2 having count(*) > 1;` returns zero rows) — otherwise
   the migration fails on apply. Note `user_id` is nullable, so NULL-`user_id` rows are
   not constrained by this index; that is correct (a row with no user is not a
   membership anyone can resolve through).

9. **Every function body that reads the old resolver reads the new one — all 14,
   verified**, with no second copy of the account-scoping logic introduced anywhere.
   Re-read from `supabase/schemas/02_functions.sql` at `c711266`; each is one call, none
   calls it twice:
   `current_account_demo()` (`:172`), `set_account_id_default()` (`:186`),
   `create_shidduch()` (`:292`), `add_redt()` (`:484`), `add_school()` (`:524`),
   `match_identity()` (`:899`), `link_reference_to_shidduch()` (`:1055`),
   `log_reference_call()` (`:1120`), `rehome_reference_link_interactions()` (`:1201`),
   `rehome_reference_interactions()` (`:1251`), `preview_reference_merge()` (`:1293`),
   `merge_references()` (`:1384`), `catch_shidduch()` (`:1575`), `ai_entitlement()`
   (`:1715`). (`set_child_portal_token_defaults()`, a 15th caller in the pre-Epic-1
   draft of this story, no longer exists — story 1.4 deleted it with the token portal.)

10. **No client-supplied context is ever trusted, and no prose still names the dead
    function.** `grep -rn "current_account_id" supabase/schemas supabase/functions
    supabase/tests src` returns **zero** hits after migration — **78 today** (67 in
    `supabase/schemas`, 7 in `supabase/tests`, 4 in `supabase/functions`, **0 in
    `src/`** — the `src/` half is already satisfied and needs no work). `supabase/migrations/`
    is **deliberately excluded**: it holds 64 hits across 11 applied migration files,
    which are immutable history and must never be rewritten. Separately,
    `grep -rniE "req\.(body|query)\..*account_id|params\..*account_id"` inside
    `supabase/functions/` returns nothing that feeds a scoping decision — the sole
    source of "which context" for any authenticated read/write is
    `current_context_id()`, never a value read off the wire.

11. **Negative test — a user in two contexts sees nothing from the inactive one.**
    New `supabase/tests/context_resolution.sql` + `.test.ts`: one auth user holds
    **two** `account_members` rows (household A, household B), each with one `singles`
    row. While `member_state.active_account_id = A`: `current_context_id()` returns A;
    a `select` on `singles`/`shidduchim`/`tasks` returns only A's rows (zero from B);
    a `select` on `accounts` returns **both** A and B (AC-7 — the user may always see
    the metadata of every context they belong to, active or not) but a `select` on
    `singles`/`shidduchim`/`tasks` still returns zero from B, proving AC-7's broader
    `accounts` read does not leak domain rows; `set_active_context(B)` succeeds and
    flips it; the domain-row selects now return only B's rows (zero from A). A second
    negative case: `set_active_context()` called with an account the user holds **no**
    membership in raises and leaves `member_state` unchanged, and `select` on `accounts`
    does not return that third account either. A third: a **freshly authenticated user
    with no `account_members` row at all** gets NULL from `current_context_id()` and
    empty results everywhere (including `accounts`), never an error and never another
    account's rows (the fail-closed case AD-19 requires).

12. **The generated migration is hand-checked, not trusted as-is.** Per AGENTS.md and
    this repo's own precedent (1.2's Dev Notes), `db diff` drops `security_invoker` /
    `REVOKE` and can render a function replacement as `DROP`+`CREATE` rather than
    preserving grants. The applied migration re-issues every grant `current_context_id()`,
    `set_active_context()` and `member_state` need (see Task 6), and contains no
    `create view … as select … current_account_id()` compatibility shim of any kind
    (NFR-14). It must also carry the three `storage.objects` policy replacements — `db
    diff` covers the `public` schema by default and may not emit `storage` changes at
    all; if it doesn't, write them into the migration by hand.

13. **The fork's `anon` default-privilege is dropped, and the new objects are
    explicitly revoked from `anon`.** The three
    `alter default privileges for role postgres in schema public grant all on
    {sequences|functions|tables} to anon;` lines in `06_grants.sql` — today at **65, 70
    and 75** — are deleted, and replaced by the matching
    `alter default privileges … revoke all on {sequences|functions|tables} from anon;`
    so an already-applied default privilege is actually withdrawn from the live
    database rather than merely absent from the schema file. This is AD-1's own
    directive ("drop the fork's `anon` default-privilege"), and story 1.1 Task A6 defers
    exactly this to Epic 2 by name ("AD-1's anon revocation is Epic 2's job"). Without
    it, every object this epic creates (`member_state` here, `invites` in 2.7, every new
    function) is silently auto-granted ALL to `anon` at creation, and "grant nothing to
    anon" in a grants file does not undo an inherited default. Additionally, following
    the file's own established revoke-then-grant pattern (`revoke all on function …
    from public, anon;`, e.g. `06_grants.sql:196-199`): `member_state`,
    `current_context_id()`, `set_active_context()`, `activate_context_for()` and
    `activate_first_context()` each get an explicit `anon` revoke
    (`activate_context_for()` is revoked from `authenticated` too — Task 2).
    Verify: `select defaclrole::regrole, defaclnamespace::regnamespace, defaclacl from
    pg_default_acl;` shows no `anon` entry for schema `public`, and
    `grep -c "to anon" supabase/schemas/06_grants.sql` returns **8** (down from **11**),
    those 8 being exactly the deliberate anon surfaces that remain at this point in the
    epic:
    `:8` `grant usage on schema public to anon`; `:16`, `:20`, `:24`, `:28` — the four
    fork trigger/helper function grants 1.2 leaves in place (`handle_new_user()`,
    `handle_update_user()`, `is_admin()`, `set_member_id_default()`); `:50`
    `init_state` (the definer view Story 2.7 deletes); `:55` `members_id_seq` and `:59`
    `tasks_id_seq`. Nothing else.

14. **Toolchain green, scoped correctly.** `make typecheck`, `npm run lint`, `make test`,
    and `npm run test:unit:db` (needs `make start`) all pass. `npx prettier --config
    ./.prettierrc.json --check` over only the files this story creates or edits — not a
    repo-wide `make lint` gate (that is a dedicated-story concern per Epic 1's own
    precedent, not this one's to demand). Note `make lint` runs `npm run lint && npm run
    prettier` repo-wide; AC-14 asks for `npm run lint` plus the scoped prettier check,
    not the repo-wide one.

## Tasks / Subtasks

- [x] **Task 1 — `member_state` table + RLS** (AC: 3)
  - [x] `supabase/schemas/01_tables.sql`: add `member_state` next to `account_members`
        (`:131-142`), with the columns in AC-3.
  - [x] `supabase/schemas/05_policies.sql`: `alter table public.member_state enable row
        level security;` and a single `select`-only policy
        (`using (user_id = auth.uid())`). Confirm no `insert`/`update`/`delete` policy
        exists for `authenticated` — the absence **is** the enforcement.
  - [x] `supabase/schemas/06_grants.sql`: `revoke all on table public.member_state from
        anon, authenticated;` then `grant select on table public.member_state to
        authenticated; grant all on table public.member_state to service_role;` —
        the explicit revoke first, matching the file's own pattern (see
        `06_grants.sql:257-259` for `identity_signals`, the closest precedent: a
        SELECT-only-for-authenticated table). AC-13; a bare "no anon grant" is not enough
        while the fork's anon default-privilege exists, and stays as defence-in-depth
        after it is dropped.

- [x] **Task 2 — The resolver and the switch function** (AC: 1, 2, 4, 5, 10)
  - [x] `supabase/schemas/02_functions.sql`: delete `current_account_id()`
        (lines **131-162** today, i.e. the function at `:146-162` plus its Dev-comment
        block at `:131-145` — the *reasoning* in that comment about fail-closed
        behaviour is worth preserving, migrated onto the new function).
  - [x] Add `current_context_id()` per AC-2. Keep it `SECURITY DEFINER` for the exact
        reason the old one was: called from RLS policies, must not recurse into them.
  - [x] Add the private writer `activate_context_for(p_user_id uuid, p_account_id
        bigint)` and `set_active_context(p_account_id bigint)` per AC-4.
  - [x] Add `activate_first_context()` (trigger function) per AC-5 to `02_functions.sql`.
        Its **trigger** goes in `supabase/schemas/04_triggers.sql`, not in the functions
        file — `02_functions.sql` contains zero `create trigger` statements and
        `04_triggers.sql` is where every one of them lives. Follow that file's own
        `create or replace trigger` style:
        `create or replace trigger activate_first_context_trigger after insert on
        public.account_members for each row when (new.status = 'active') execute
        function public.activate_first_context();`. It calls
        `activate_context_for()` — **never** `set_active_context()`, whose
        `auth.uid()` validation is NULL inside the `handle_new_user()` signup path
        (AC-5's rationale).
  - [x] `06_grants.sql`: for each of the four new functions, `revoke all on function …
        from public, anon;` then grant `execute` to `authenticated` and `service_role`
        (AC-13 — copy the exact pattern at `06_grants.sql:201-204` for
        `current_account_demo()`) — **except** `activate_context_for()`, which
        additionally gets no `authenticated` grant at all: only `service_role` and the
        two `SECURITY DEFINER` callers reach it. The `current_account_id()`
        revoke/grant lines at `06_grants.sql:197-199` disappear with the function, and
        the comment above them at `:196` is reworded to name `current_context_id()`.

- [x] **Task 3 — Migrate the 20 RLS policies** (AC: 6, 7)
  - [x] Work `05_policies.sql` table by table using AC-6's list (rows 1-17). For 15 of
        those 17 it is a literal token swap (`current_account_id()` →
        `current_context_id()`) inside existing `using`/`with check` clauses — no other
        change.
  - [x] `accounts`'s and `account_members`'s policies each get AC-7's corrected shape,
        not the literal swap.
  - [x] Re-read `interactions`' policy in full before editing it — it has **eight**
        occurrences of the old resolver (`05_policies.sql:142, 152, 153, 162, 168, 178,
        179, 188`) across one `using` and one `with check` clause (four each: the base
        `account_id` check, two inside the `reference` branch's join, one inside the
        `shidduch` branch); all eight move together or the policy silently diverges
        between read and write.
  - [x] **`supabase/schemas/07_storage.sql`** — rows 18-20 of AC-6's table. Three
        `storage.objects` policies, one occurrence each, all of the form
        `(storage.foldername(name))[1] = public.current_account_id()::text`. Swap all
        three. Missing this file breaks every attachment read, write and delete.

- [x] **Task 4 — Hardening: unique index + anon default-privilege drop** (AC: 8, 13)
  - [x] `01_tables.sql`: add the partial unique index from AC-8 next to
        `account_members`'s existing index (`account_members_account_id_idx`,
        `01_tables.sql:623`). Run AC-8's duplicate-check query against the local DB first.
  - [x] `06_grants.sql`: replace the three `alter default privileges … grant all on
        {sequences|functions|tables} to anon;` lines (**65, 70, 75**) with the
        corresponding `… revoke all on … from anon;` statements (AC-13). Do **not**
        touch the `postgres`/`authenticated`/`service_role` default-privilege lines —
        AD-1 names only the `anon` ones. The comment block at **`06_grants.sql:83-87`**
        ("Full revocation of the anon default-privilege itself is Epic-1 / F6 and
        deferred") is updated to record that this story closed it.

- [x] **Task 5 — Migrate the 14 function bodies** (AC: 9)
  - [x] Work `02_functions.sql` top to bottom using AC-9's list. Each is a literal
        `public.current_account_id()` → `public.current_context_id()` swap inside a
        `v_account_id := …` assignment (12 of them) or an inline expression
        (`current_account_demo()`'s `where a.id = …`, `set_account_id_default()`'s
        `new.account_id := …`). Confirm with `grep -n current_account_id
        supabase/schemas/02_functions.sql` before and after — this is SQL, so the plain
        grep is the authority; `.claude/rules/lsp-usage.md` scopes the LSP tool to
        `.ts/.tsx/.js/.jsx`, which covers none of this story's files.
  - [x] Update the **four** prose comments that name `current_account_id()` without
        calling it: `02_functions.sql:16` (`handle_new_user`'s header), `:166`
        (`current_account_demo`'s header), `:866` (`match_identity`'s header), `:1695`
        (`ai_entitlement`'s header). A fifth mention at `:138` sits inside
        `current_account_id()`'s own comment block and is deleted with the function in
        Task 2. Grep total for the file goes **20 → 0**.

- [x] **Task 6 — Generate and hand-check the migration** (AC: 12)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        context_aware_authorisation`.
  - [x] Confirm the diff does **not** render `current_account_id()`'s replacement as a
        silent no-op — a `DROP FUNCTION` for the old signature plus `CREATE FUNCTION`
        for the new name is expected and correct (different name = different object,
        unlike a same-name `CREATE OR REPLACE`).
  - [x] Re-add every `REVOKE`/`GRANT` the diff drops for the 17 edited `public` policies
        (it regenerates the policy bodies but has a history of dropping the surrounding
        grant statements — see 1.2 Dev Notes precedent) and for the four new functions
        and `member_state`.
  - [x] Confirm the migration carries the three `storage.objects` policy replacements
        (AC-6 rows 18-20). `db diff` targets the `public` schema; if the `storage`
        changes are absent, hand-write them, following
        `supabase/migrations/20260726214835_secure_attachments_bucket.sql` — the
        migration that created these three policies — as the shape precedent.
  - [x] Confirm the migration carries the three `alter default privileges … revoke …
        from anon` statements (AC-13) — `db diff` may not emit default-privilege
        changes at all; if it doesn't, write them into the migration by hand.
  - [x] Apply with `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up
        --local`. **Never `db reset` and never `db push`.**

- [x] **Task 7 — Update the surviving non-schema references** (AC: 10)
  - [x] Prose comments in the remaining schema files, which AC-10's grep also catches:
        `supabase/schemas/01_tables.sql:82` ("multi-account current_account_ids"),
        `supabase/schemas/05_policies.sql:30` and `:33` (the pipeline-RLS header block).
        All three describe multi-account scoping as deferred future work — reword to
        record that this story delivered it, naming `current_context_id()`.
  - [x] Edge functions, comments only: `supabase/functions/users/index.ts:72`,
        `supabase/functions/clear_demo/index.ts:22`,
        `supabase/functions/_shared/resolveDemoAccount.ts:27`,
        `supabase/functions/merge_references/index.ts:99` — reword to name
        `current_context_id()`. No edge-function logic changes.
  - [x] Tests: `supabase/tests/billing_entitlement.sql:102,132` and
        `supabase/tests/references_entity.sql:114,224,366,437,445` — rename the calls
        (`:437` is a comment). These files' fixtures create exactly one membership per
        user, so the `activate_first_context` trigger will populate `member_state` for
        them automatically and both suites must stay green unchanged apart from the
        rename; if either goes red, the trigger (AC-5) is wrong, not the test.
  - [x] `references_entity.sql:366` ("RLS: tenant B resolves to its own account") and
        `:445` (the fail-closed "a user with no membership resolves to NO account" case)
        are this story's direct precedent — read them before writing Task 8's new suite
        so the new tests extend the same pattern rather than inventing a second one.

- [x] **Task 8 — New test suite + negative tests** (AC: 3, 6, 7, 11)
  - [x] `supabase/tests/context_resolution.sql` + `.test.ts`, same shape as
        `references_entity.sql`/`.test.ts`: `\set ON_ERROR_STOP on`, `begin;`, temp
        `results (name, passed, detail)` / `ids` tables `on commit drop`, one row per
        check, JSON emitted at the end, rolled back. The `.test.ts` shells out to `psql`
        via `execFileSync`, defaults `SUPABASE_DB_URL` to
        `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, and **must** use the
        shared `bailIfDbUnreachable` helper from `supabase/tests/dbSuiteHelpers.ts`
        (skips locally, throws in CI). Impersonate with `set local role authenticated;`
        + `set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'`, and
        `reset role;` at the end. Register nothing new in `vitest.config.ts` — the `db`
        project already globs this directory (`npm run test:unit:db`).
  - [x] Cover AC-11's three cases in full, plus: `member_state` cannot be written
        directly by `authenticated` (AC-3 — a `do $$ … exception when others` block,
        the pattern at `references_entity.sql:424-433`), `account_members`'s corrected
        policy hides a foreign member's row in an inactive context while still showing
        the caller's own (AC-7), and the `activate_first_context` trigger auto-activates
        a first membership but leaves a second one alone (AC-5).
  - [x] Do not duplicate `references_entity.sql`'s existing tenant-isolation checks —
        this new file is specifically about **one user, multiple contexts**, which no
        existing file covers.

- [x] **Task 9 — Verify** (AC: 10, 13, 14)
  - [x] Run the AC-10 greps (scoped to `supabase/schemas supabase/functions
        supabase/tests src`, never `supabase/migrations`); both must be empty.
  - [x] Run AC-13's `pg_default_acl` query and `grep -c "to anon"
        supabase/schemas/06_grants.sql`; confirm the count is **8** and the survivor set
        is exactly the one AC-13 enumerates.
  - [x] `select to_regproc('public.current_account_id')` returns NULL (AC-1).
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`.
  - [x] `npx prettier --config ./.prettierrc.json --check` over this story's changed
        files only.

## Dev Notes

### Why `order by am.id limit 1` is the whole epic's blocker

> "`public.current_account_id()` resolves a user to one arbitrary account (`order by
> am.id limit 1`) and every RLS policy depends on it. Personas and contexts are
> unbuildable until it is rewritten (Epic 2)."
> [Source: _bmad-output/planning-artifacts/epics.md:30-32]

The current function (`supabase/schemas/02_functions.sql:146-162`) already has a
fail-closed comment explaining the **previous** bug it fixed (falling back to account
#1 when the caller had no membership at all) — but it still has exactly one row's worth
of context-awareness: `order by am.id limit 1` picks whichever membership row sorts
first, with zero regard for which one the user actually wants active. FR83/FR84 (two
context types, active context explicit and never inferred) and AD-19 are not
implementable on top of that function; they require it to consult a **held choice**,
which is what `member_state` is for.

### The `members` / `account_members` naming — decided closed, not punted

1.2 (`sales`→`members`) flagged that `public.members` (the profile table) and
`public.account_members` (the membership/role table the glossary calls "member") now
sit one word apart, and explicitly punted resolving it to Epic 2:

> "If the planner wants the collision resolved rather than documented, that is Epic 2
> work (`current_context_id()` / AD-19 rewrites the membership model anyway) — raise
> it, do not invent a third name."
> [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md:265]

This story does not rename either table, and the collision is now **decided closed,
permanently**, not merely documented: both names are the contract's own. AD-23 mandates
`members` for the user/profile table ("The user/profile table is **`members`**, not
`sales`"), and AD-2 mandates `account_members` for the membership table
(`account_members(account_id, user_id, role, status)`, verbatim). The glossary's
"member — a login's membership of a context, carrying a role" describes
`account_members`; the profile row is the login itself. Two contract-mandated names
cannot be a collision to resolve — inventing a third name would *violate* the spine,
not tidy it. 1.2 shipped the breadcrumb (`01_tables.sql:58`,
`comment on column public.tasks.member_id`, plus the block comment at `:53-57`) —
keep it; nothing further is owed by any story.

Note the referent split this story must not confuse: `tasks.member_id` → `public.members`;
`singles.member_id`, `shidduchim.owner_member_id`, `interactions.actor_member_id` →
`public.account_members` (`01_tables.sql:525, 543, 598`). `member_state.user_id` is
neither — it is `auth.users(id)` directly, matching `account_members.user_id` and
`auth.uid()`.

### What this story deliberately does not touch

- **`public.members`'s `using (true)` read policy** (`05_policies.sql:12`). Every
  authenticated user can read every profile row today; that predates this story and 1.2
  explicitly preserved it ("Hardening `members` … account-scoping the read … is AD-1 /
  Epic 2, explicitly not this story" — referring to *1.2*, not this one). Tightening it
  needs the persona/context model this story does not build (you cannot scope "who shares
  a context with me" without `accounts.kind` and the persona vocabulary) — it is
  **Story 2.2's** to do, and 2.2's Dev Notes should cite this paragraph rather than
  re-derive the reasoning.
- **`is_admin()` / `configuration`.** AD-2 says "Retire `is_admin()`/`isInitialized`,"
  and Epic 1 deferred both to Epic 2 by name (1.2 AC-5: "retiring `is_admin()` itself
  is AD-1 / Epic 2, **not** this story"). Both halves are **Story 2.7's**: it deletes
  `isInitialized`/`init_state` with the invite-only signup gate, and it retires
  `is_admin()` and the `configuration` write path with it (see 2.7's own AC and Dev
  Notes for the full package, including why Settings' entry points stop being
  admin-gated). This story touches neither — it only needs to know `configuration`'s
  `is_admin()`-gated policies (`05_policies.sql:22-24`) call the old resolver nowhere
  (verified — they don't).
- **`FORCE ROW LEVEL SECURITY`.** AD-1 calls for it on every table; none of today's
  tables have it (`alter table … enable row level security` only, never `force`). No
  story in Epic 2's stated text asks for a table-by-table FORCE-RLS audit. With AC-13's
  anon default-privilege drop and the per-table `anon` revokes already in
  `06_grants.sql`, `FORCE`'s practical effect is defence-in-depth against a future
  accidental grant (and against table-owner access), not a live gap this story's own
  negative tests exercise. `member_state` (new in this story) gets ordinary RLS,
  matching every other table added so far; a repo-wide FORCE-RLS pass plus AD-1's CI
  assertion (`rowsecurity = true` on every `public` table, one scoping axis per table)
  remains an AD-1 gap with no assigned story anywhere in Epics 1–11 — flagged
  for the epic owner, not silently absorbed here.
- **`src/`.** Zero files under `src/` mention `current_account_id` (verified — the
  grep returns nothing), and route/resource registration moved to
  `src/components/atomic-crm/root/routeManifest.ts` in story 1.5. This story adds no
  route, no resource and no component, so `routeManifest.ts` is not edited. The frontend
  consumers of `current_context_id()`/`set_active_context()` arrive in 2.2 and 2.4.

### The `accounts` / `account_members` policy shape — read this before Task 3

A literal swap (`account_id = current_context_id()` / `id = current_context_id()`) on
`account_members` and `accounts` is the single easiest mistake in this story, and it is
subtle: it *looks* like the same transformation every other table gets, and it compiles,
and every existing test still passes — because no existing test has one user in two
contexts. It breaks Story 2.4 (context switcher) before that story is ever started,
because "list every context I belong to, with enough metadata to render it as a switch
target" is a query against **both** tables for **every** membership, which a naive swap
would filter down to one row on each. AC-7's corrected shapes are the fix; Task 8's new
negative test is what proves both are correct in *every* direction: a caller's own
membership/account rows are always visible regardless of which is active, a
**stranger's** membership row in a context that is not currently active is not, and a
**third** account the caller holds no membership in at all is never visible on either
table.

### Verified call sites (re-counted against `main` @ `c711266`, 2026-07-28)

**20 policies** call `current_account_id()` — 17 in `05_policies.sql`, 3 in
`07_storage.sql` (AC-6's table). Raw occurrence counts today:

| File | Occurrences | Breakdown |
|---|---|---|
| `supabase/schemas/05_policies.sql` | 39 | 37 in 17 policy bodies + 2 in prose comments (`:30`, `:33`) |
| `supabase/schemas/02_functions.sql` | 20 | 1 definition (`:146`) + 1 inside its own comment (`:138`) + 4 other headers (`:16`, `:166`, `:866`, `:1695`) + 14 calls |
| `supabase/schemas/06_grants.sql` | 4 | `:196` comment + `:197-199` revoke/grant |
| `supabase/schemas/07_storage.sql` | 3 | 3 policies, 1 each |
| `supabase/schemas/01_tables.sql` | 1 | `:82` comment (`current_account_ids`, plural) |
| `supabase/tests/` | 7 | `billing_entitlement.sql` 2, `references_entity.sql` 5 |
| `supabase/functions/` | 4 | comments only, 1 file each |
| `src/` | **0** | already clean |
| **Total in scope** | **78** | must reach 0 |
| `supabase/migrations/` | 64 across 11 files | **out of scope — immutable history** |

> **⚠️ Do not miss the storage policies.** Commit `31183f2` ("SECURITY: make the
> attachments bucket private and account-scoped") added three account-scoped policies on
> `storage.objects` — `Attachments readable within account`, `Attachments writable
> within account`, `Attachments deletable within account` — each calling
> `current_account_id()` in `supabase/schemas/07_storage.sql`. They live in a
> **different schema file** from every other policy this story touches, in a
> **different Postgres schema** (`storage`, not `public`) that `db diff` does not cover
> by default. An inventory built only from `05_policies.sql` silently misses them, and
> deleting the resolver without migrating these three breaks **every attachment upload
> and read** (resumes and photos). They are rows 18-20 of AC-6's table and Task 3's last
> subtask, and Task 6 checks the generated migration actually carries them.

**14 functions** call it in their bodies (AC-9's list) — each exactly once, all in
`02_functions.sql`. The pre-Epic-1 draft of this story listed a 15th caller,
`set_child_portal_token_defaults()`; story 1.4 deleted it with the token portal and it
is correctly absent from AC-9.

**4 edge-function files** mention it only in comments (Task 7); **2 test files**
(`billing_entitlement.sql`, `references_entity.sql`) call it inside assertions and are
this story's direct precedent for the negative-test pattern (Task 8).

### Migration workflow (repo-specific)

- `supabase/schemas/*.sql` is the source of truth. Edit it, then
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
  context_aware_authorisation`, then
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. The
  `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is mandatory on this machine or every
  `npx supabase` call hangs in the D-Bus keyring lookup (looks like a Docker fault, is
  not — see the project memory note on this).
- **Never `db reset --local`** (destructive) and **never `db push`** (the deploy-time
  round, owned by the orchestrator, not a ticket).
- `db diff` has a history of dropping `security_invoker`/`REVOKE` lines and grants tied
  to a function it regenerates (precedent: `20260722130000_shidduch_redts.sql`,
  `20260724124914_revoke_accounts_decoy_writes.sql`, and 1.2's Dev Notes for the same
  caution). Diff the generated migration against the edited `05_policies.sql`,
  `06_grants.sql`, `01_tables.sql`, `07_storage.sql` by hand.
- Function bodies must match `pg_dump` formatting exactly (`npx supabase db dump
  --local --schema public`) or the next `db diff` reports a phantom diff. Copy the
  existing `SET "search_path" TO ''` / `SECURITY DEFINER` quoting style verbatim from
  `current_account_id()`'s own definition (`02_functions.sql:146-149`) when writing
  `current_context_id()`.

### Security posture — this is the definitive `.claude/rules/security-triggers.md` case

This story touches authentication-adjacent authorization, every RLS policy in the
product (including the storage bucket that holds resumes and photos — PRV-1's
highest-sensitivity data), and a new `SECURITY DEFINER` function pair. A security review
is not optional. The three things a reviewer should specifically hunt for: (1) any policy
left calling the deleted function — a `to_regproc`/grep check settles it (AC-1/AC-10),
and the check must include `07_storage.sql`; (2) any path that writes `member_state`
other than through `set_active_context()` / `activate_context_for()` (AC-3's "no
insert/update policy" is the actual enforcement — verify by attempting a raw `update` as
an ordinary authenticated role and confirming it is denied, not merely untested); and
(3) whether `activate_first_context()` can be induced to move an established user's
active context by inserting a membership on their behalf (AC-5 says it must not — the
"already has a live active membership" guard is what stops an invite from silently
relocating someone).

### Testing standards

- SQL/RLS tests: `supabase/tests/<name>.sql` + `<name>.test.ts`, run via `npm run
  test:unit:db` against the local stack (`make start` first). Follow
  `references_entity.sql`'s shape exactly: `\set ON_ERROR_STOP on`, `begin;`, a
  `results` temp table (`name, passed, detail`) plus an `ids` temp table for values that
  must cross a `do $$` block boundary (psql does not interpolate `:variables` inside
  dollar quotes), one row per assertion, `on commit drop`, rolled back so nothing
  persists. The `.test.ts` shells out to `psql` and turns each row into a named `it()`,
  and reuses `bailIfDbUnreachable` from `supabase/tests/dbSuiteHelpers.ts`. Do not invent
  a second test harness shape and do not add a new vitest project.
- `.claude/rules/testing.md`: AAA structure, no shared mutable state between tests, no
  `waitForTimeout`-style flakiness (n/a here — this is DB-only, no Playwright).
- `.claude/rules/security-triggers.md`: mandatory negative test for any RLS-touching
  change — AC-11 is that test.

### Project Structure Notes

No new frontend surface in this story — it is schema-only (`supabase/schemas/*.sql`,
`supabase/migrations/*.sql`, `supabase/tests/*.sql`+`.test.ts`) plus four comment-only
edits under `supabase/functions/`. It changes no `src/` file, and in particular does not
touch `src/components/atomic-crm/root/routeManifest.ts` (story 1.5's manifest, now the
single registration point for every route and resource). Downstream stories (2.2 onward,
plus the frontend context switcher in 2.4) are what consume
`current_context_id()`/`set_active_context()`.

### References

- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-19]
  — `member_state(user_id, active_account_id)`, `current_context_id()`,
  `set_active_context()`, fail-closed, "`current_account_id()` … is deleted, not
  wrapped", "Accepted cost: one active context per user, not per browser tab."
- [Source: …/ARCHITECTURE-SPINE.md#AD-1] — tenant isolation is scope + RLS,
  deny-by-default, `FORCE ROW LEVEL SECURITY`, "drop the fork's `anon`
  default-privilege" (AC-13), CI RLS assertions (flagged above as not this story's to
  complete).
- [Source: …/ARCHITECTURE-SPINE.md#AD-2] — `account_members(account_id, user_id, role,
  status)`, a login may hold several memberships simultaneously, "Retire
  `is_admin()`/`isInitialized`" (both halves are Story 2.7's).
- [Source: …/ARCHITECTURE-SPINE.md#AD-23] — "The user/profile table is `members`, not
  `sales`"; the fossil tables dropped outright (Epic 1, done).
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:41,45]
  — FR83 (two context types) and FR84 (explicit active context, never inferred).
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md:81] — "The active context is a
  server-side row, chosen explicitly … a client-supplied context is never trusted."
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md:43] — "the
  active context is a server-side row, and exactly one context is readable at any moment."
- [Source: supabase/schemas/02_functions.sql:131-162] — the current `current_account_id()`
  and its own fail-closed history, read in full before writing the replacement.
- [Source: supabase/schemas/05_policies.sql] and
  [Source: supabase/schemas/07_storage.sql] — the complete current RLS surface; every
  policy in AC-6's table was read from these two files line by line, not assumed.
- [Source: supabase/migrations/20260726214835_secure_attachments_bucket.sql] — commit
  `31183f2`, the migration that created the three `storage.objects` policies AC-6 rows
  18-20 migrate.
- [Source: _bmad-output/implementation-artifacts/1-1-delete-fossil-resources.md:141] —
  "AD-1's anon revocation is Epic 2's job", the deferral AC-13 closes.
- [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md:251-265]
  — the `members`/`account_members` naming, decided closed here rather than renamed.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-code, bmad-dev-story workflow)

### Debug Log References

- Pre-flight duplicate-active-membership check against the local DB found ONE
  violation: `account_id=1, user_id=2e96ce26-…` had two identical
  `parent_admin`/`active` rows (ids 80 and 81, `test@local.dev`, created 41ms
  apart — a local double-submit artifact, not real data). Deleted the
  duplicate (id 81) before adding AC-8's unique index; this is a local-DB-only
  fix, not part of the migration. The hosted DB (krlqkxlczxlgienjunmd) was
  **not** checked from this session — flagged below for the deploy-round
  pre-flight, per the build plan's own instruction.
- First `db diff` generation omitted: (a) all three `alter default privileges
  … revoke … from anon` statements (AC-13) — confirmed via
  `grep -i "default privileges"` returning nothing in the generated file —
  and (b) every `revoke`/`grant execute` statement for the four new functions,
  and (c) the explicit `revoke all … from anon, authenticated` for the new
  `member_state` table (it kept only the additive grants, leaving
  `authenticated` with a stray TRUNCATE/REFERENCES/TRIGGER/MAINTAIN it should
  not have). All three hand-added to the generated migration file, matching
  AC-12/Task 6's explicit expectation that `db diff` needs hand-checking.
- First `migration up --local` attempt failed hard (not a CASCADE) on
  `drop function if exists "public"."current_account_id"()`: the generated
  migration placed the 3 `storage.objects` policy drop+recreate at the very
  end of the file, after the function drop, so at the point of the drop the
  storage policies still depended on the old function
  (`ERROR: cannot drop function current_account_id() because other objects
  depend on it`). This is exactly the landmine's predicted risk. Fixed by
  moving the three `drop policy … on storage.objects` statements up to sit
  with the other 17 policy drops, immediately before the function drop
  (their `create policy` recreations were left in place at the end of the
  file). No `CASCADE` was ever used.
- `db diff -f verify_no_diff` re-run after all hand-edits and the local grant
  correction: **"No schema changes found"** — the hand-edited migration file
  and the declarative schema files agree exactly, and the migration rebuilds
  a schema-only DB (from a clean shadow container) identically to what the
  applied local DB now has. No leftover migration file was generated (empty
  diff).
- Verification queries all match the story's stated expectations exactly:
  `to_regproc('public.current_account_id') is null` → `t`; policies still
  naming the old resolver → `0`; `storage.objects` policies naming the new
  resolver → `3`; `grep -c "to anon" 06_grants.sql` → `8` (exact survivor set
  named in AC-13); AC-10's repo-wide grep (`supabase/schemas`,
  `supabase/functions`, `supabase/tests`, `src`) → empty, except the new
  `context_resolution.sql`'s own `to_regproc('public.current_account_id') is
  null` assertion, which legitimately names the retired function to prove its
  absence (same established pattern as `members_rename.sql:38`'s
  `to_regproc('public.set_sales_id_default') is null`).

### Completion Notes List

- All 14 ACs implemented and verified against the local Supabase stack.
  `current_account_id()` is deleted (not wrapped); `current_context_id()`,
  `set_active_context()`, `activate_context_for()` and `activate_first_context()`
  added; `member_state` table + RLS + grants added; all 20 RLS policies (17 in
  `05_policies.sql`, 3 in `07_storage.sql`) migrated, with `accounts` and
  `account_members` getting AC-7's corrected (non-literal-swap) shapes; the 14
  function-body call sites and 4 prose-comment headers in `02_functions.sql`
  migrated; the AC-8 partial unique index added (after clearing the one local
  duplicate found in Debug Log); the AC-13 anon default-privilege revoke and
  per-object grants for the new table/functions added.
- The generated migration
  (`supabase/migrations/20260727223658_context_aware_authorisation.sql`)
  required three hand-corrections before it would apply cleanly — see Debug
  Log for detail. All three are exactly the categories of gap AC-12/Task 6
  and the story's own landmines call out (`db diff` missing default-privilege
  statements, missing function grants, and mis-ordering the storage-policy
  drop relative to the function drop). None involved `CASCADE`.
- New test suite `supabase/tests/context_resolution.sql` +
  `context_resolution.test.ts` (39 checks, all green) covers: the
  `activate_first_context` trigger (activates on first live membership,
  leaves a second one alone), AC-11's three cases (two-context visibility
  and its flip via `set_active_context`, a refused switch to a non-member
  account, and a fully unprovisioned user resolving to NULL everywhere with
  no error), AC-3's `member_state` write refusal (UPDATE, INSERT, and a
  direct call to `activate_context_for`), AC-7's `account_members`/`accounts`
  corrected shapes (own rows always visible, a foreign member's row visible
  only inside the active context, a third unrelated account never visible on
  either table), an explicit no-infinite-recursion check on a plain
  `select * from accounts` (the landmine's specific concern), AC-8's
  duplicate-active-membership rejection, and structural grant/RLS assertions
  (anon has zero privilege on `member_state` or any of the four new
  functions; `authenticated` cannot call `activate_context_for`).
- Rewrote the 7 existing `current_account_id()` references in
  `supabase/tests/billing_entitlement.sql` (2) and
  `supabase/tests/references_entity.sql` (5) to name the new resolver; both
  suites stayed green with no other change, confirming the
  `activate_first_context` trigger populates `member_state` transparently for
  their existing single-membership-per-user fixtures.
- **Handed to Story 2.2** (per this story's own instruction, not fixed here):
  `providers/supabase/dataProvider.ts`'s `getCurrentAccountId()` (or
  equivalent) still does a first-row `accounts` pick rather than reading the
  active context via `my_contexts()`/RPC — grep confirms `src/` has zero
  mentions of `current_account_id` today, so this is a pre-existing
  first-row-pick pattern independent of the deleted SQL function, not a
  regression this story introduced. Flagging it explicitly per the build
  plan's Story 2.4 section, which names this exact fix as its own
  highest-value change.
- **Flagged, not actioned**: this story's local-DB duplicate-membership
  cleanup (Debug Log) was necessary for AC-8's index to apply locally. The
  hosted database (krlqkxlczxlgienjunmd) has not been checked for the same
  class of violation from this session — the build plan's own Step 1
  pre-flight already calls this out as a prerequisite for the deploy round,
  and the AC-8 dev note explicitly warns this can differ between local and
  hosted. Re-run the duplicate-check query against hosted before `db push`.
- `make typecheck`, `npm run lint`, `make test` (573 tests, all projects),
  and `npm run test:unit:db` (183 tests, 5 suites) all pass. Scoped
  `npx prettier --check` over this story's edited TS files (the 4 edge
  function comment-only files plus the new `.test.ts`) passes; `.sql` files
  are outside the repo's prettier glob (`package.json`'s `prettier` script),
  confirmed by prettier itself refusing to infer a parser for them, so they
  were not run through it.

### File List

- `supabase/schemas/01_tables.sql` — added `member_state` table + its 2 FK
  constraints; added the `account_members_account_user_active_uq` partial
  unique index (AC-8); reworded the `:82` prose comment (AC-10).
- `supabase/schemas/02_functions.sql` — deleted `current_account_id()`;
  added `current_context_id()`, `activate_context_for()`,
  `set_active_context()`, `activate_first_context()`; migrated the 14
  function-body call sites and 4 prose-comment headers (AC-9/AC-10).
- `supabase/schemas/04_triggers.sql` — added `activate_first_context_trigger`
  (AFTER INSERT on `account_members`, WHEN `new.status = 'active'`).
- `supabase/schemas/05_policies.sql` — enabled RLS + added the SELECT-only
  policy on `member_state`; migrated all 17 `public`-schema policies (15
  literal token swaps + `accounts`/`account_members`'s AC-7 corrected
  shapes); reworded the `:30`/`:33` prose comments (AC-10).
- `supabase/schemas/06_grants.sql` — replaced the 3 anon default-privilege
  grants with revokes (AC-13); added `member_state`'s table grants; deleted
  `current_account_id()`'s grant block and added grants for the 4 new
  functions (`activate_context_for()` excluded from the `authenticated`
  grant per AC-13); reworded the F6 deferral comment.
- `supabase/schemas/07_storage.sql` — migrated the 3 `storage.objects`
  policies (AC-6 rows 18-20).
- `supabase/functions/users/index.ts`,
  `supabase/functions/clear_demo/index.ts`,
  `supabase/functions/_shared/resolveDemoAccount.ts`,
  `supabase/functions/merge_references/index.ts` — comment-only rewording
  (AC-10); no logic changes.
- `supabase/tests/billing_entitlement.sql`,
  `supabase/tests/references_entity.sql` — renamed the 7 existing
  `current_account_id()` references to `current_context_id()` (AC-10); no
  other change.
- `supabase/tests/context_resolution.sql` (new),
  `supabase/tests/context_resolution.test.ts` (new) — Task 8's new suite
  (AC-3, AC-6, AC-7, AC-11).
- `supabase/migrations/20260727223658_context_aware_authorisation.sql` (new,
  generated by `db diff` then hand-corrected per Debug Log) — the applied
  migration.
