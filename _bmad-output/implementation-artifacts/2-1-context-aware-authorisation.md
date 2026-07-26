# Story 2.1: Context-Aware Authorisation

Status: ready-for-dev

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

**Written against the post-Epic-1 world** (see AGENTS-level task brief): `children` is
`singles`, `sales` is `members`, the fork tables and the token portal are gone, and
`root/CRM.tsx`'s resource registration is `routeManifest.ts`. Object names below (table
names, policy names, function bodies) are given in their **post-rename** form. Exact
line numbers will have moved once 1.1–1.6 land; the verified **counts** and **object
names** will not — they were produced against `main` @ `8ad49cb` (2026-07-26) and
cross-checked against every Epic 1 story's stated renames (1.2 for `sales`→`members`,
1.3 for `children`→`singles`, 1.4 for the deleted token portal).

## Acceptance Criteria

1. **The resolver is context-aware, not first-row.** `public.current_account_id()`
   (`supabase/schemas/02_functions.sql:527-543` today — `order by am.id limit 1`) is
   **deleted**, not deprecated or wrapped. `select to_regproc('public.current_account_id')`
   returns NULL after migration.

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
   updated_at timestamptz not null default now())` — AD-19's own naming, verbatim. RLS:
   a caller may `select` their own row; there is **no** `insert`/`update`/`delete`
   policy for `authenticated` at all, so the only way the row changes is through
   `set_active_context()` (`SECURITY DEFINER`, bypasses RLS internally). A negative
   test proves `update public.member_state set active_account_id = <other> where
   user_id = auth.uid()` fails for an ordinary authenticated client.

4. **Switching context is one validated function, not a raw write.**
   `public.set_active_context(p_account_id bigint) returns void`, `SECURITY DEFINER`,
   `SET search_path TO ''`. It raises (`no active membership of account %`) unless
   `exists (select 1 from public.account_members where user_id = auth.uid() and
   account_id = p_account_id and status = 'active')`; on success it upserts
   `member_state`. This is the **only** write path onto `member_state` (AC-3 makes the
   alternative — a raw client UPDATE — impossible; AD-19: "Switching goes through
   `set_active_context(account_id)`, which validates membership before writing").

5. **A user's first context activates itself; gaining a second never silently moves
   them.** An `after insert` trigger on `public.account_members`
   (`activate_first_context()`) calls the **same validated path** as
   `set_active_context()` — it does not re-implement the check — and only acts when the
   inserted row is `active` and the user has no `member_state` row yet, or their
   existing `active_account_id` no longer resolves through `current_context_id()`'s own
   rule. Adding a second context to a user who already has a working active one does
   nothing to `member_state` (this is what lets FR84's "never inferred" and 2.4's "a
   user with one context sees no switcher clutter" both hold from the moment a context
   exists, without a UI-side bootstrap step).

6. **Every RLS policy that reads the old resolver reads the new one — all 17,
   verified.** No table is missed and no table gets a second, divergent scoping
   expression. The complete list, by table and policy name (post-rename). 15 of the 17
   get a literal `using`/`with check` token swap (`current_account_id()` →
   `current_context_id()`) with no other behavioural change; `accounts` and
   `account_members` each get AC-7's corrected shape instead of the literal swap:

   | # | Table | Policy |
   |---|---|---|
   | 1 | `accounts` | `Account access scoped to member` — **gets AC-7's shape fix** |
   | 2 | `account_members` | `Account members scoped to account` — **gets AC-7's shape fix** |
   | 3 | `singles` | `Singles scoped to account` |
   | 4 | `shadchanim` | `Shadchanim scoped to account` |
   | 5 | `references` | `References scoped to account` |
   | 6 | `shidduchim` | `Shidduchim scoped to account` |
   | 7 | `resumes` | `Resumes scoped to account` |
   | 8 | `reference_links` | `Reference links scoped to account` |
   | 9 | `date_records` | `Date records scoped to account` |
   | 10 | `redts` | `Redts scoped to account` |
   | 11 | `shidduch_schools` | `Shidduch schools scoped to account` |
   | 12 | `interactions` | `Interactions scoped to account and parent visibility` |
   | 13 | `identity_signals` | `Identity signals readable within account` |
   | 14 | `subscription` | `Subscription readable within account` |
   | 15 | `ai_usage` | `AI usage readable within account` |
   | 16 | `inbox_items` | `Inbox items scoped to account` |
   | 17 | `tasks` | `Tasks scoped to account` |

   (`pipeline_transitions`'s `using (true)` and `configuration`'s `is_admin()`-gated
   policies do not call the old resolver and are untouched — nothing to migrate.
   `members`'s own `using (true)` read policy likewise calls neither resolver; **it stays
   out of this story's scope on purpose** — see Dev Notes "What this story deliberately
   does not touch.")

7. **`accounts` and `account_members` each get the one shape correction the swap
   forces, not a copy-paste of the other 15.** A straight `= current_context_id()` swap
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
   even by accident.

9. **Every function body that reads the old resolver reads the new one — all 14,
   verified**, with no second copy of the account-scoping logic introduced anywhere:
   `current_account_demo()`, `set_account_id_default()`, `create_shidduch()`,
   `add_redt()`, `add_school()`, `match_identity()`, `link_reference_to_shidduch()`,
   `log_reference_call()`, `rehome_reference_link_interactions()`,
   `rehome_reference_interactions()`, `preview_reference_merge()`,
   `merge_references()`, `catch_shidduch()`, `ai_entitlement()`.

10. **No client-supplied context is ever trusted.** `grep -rniE
    "current_account_id"` returns **zero** hits anywhere in `supabase/` and `src/`
    after migration (function deleted, every call site updated). Separately,
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
    (NFR-14).

13. **Toolchain green, scoped correctly.** `make typecheck`, `npm run lint`, `make test`,
    and `npm run test:unit:db` (needs `make start`) all pass. `npx prettier --config
    ./.prettierrc.json --check` over only the files this story creates or edits — not a
    repo-wide `make lint` gate (that is a dedicated-story concern per Epic 1's own
    precedent, not this one's to demand).

## Tasks / Subtasks

- [ ] **Task 1 — `member_state` table + RLS** (AC: 3)
  - [ ] `supabase/schemas/01_tables.sql`: add `member_state` next to `account_members`,
        with the columns in AC-3.
  - [ ] `supabase/schemas/05_policies.sql`: `alter table public.member_state enable row
        level security;` and a single `select`-only policy
        (`using (user_id = auth.uid())`). Confirm no `insert`/`update`/`delete` policy
        exists for `authenticated` — the absence **is** the enforcement.
  - [ ] `supabase/schemas/06_grants.sql`: `grant select on table public.member_state to
        authenticated; grant all on table public.member_state to service_role;` — no
        `anon` grant.

- [ ] **Task 2 — The resolver and the switch function** (AC: 1, 2, 4, 5, 10)
  - [ ] `supabase/schemas/02_functions.sql`: delete `current_account_id()`
        (lines 512-543 today, including its Dev-comment block — the *reasoning* in that
        comment about fail-closed behaviour is worth preserving, migrated onto the new
        function).
  - [ ] Add `current_context_id()` per AC-2. Keep it `SECURITY DEFINER` for the exact
        reason the old one was: called from RLS policies, must not recurse into them.
  - [ ] Add `set_active_context(p_account_id bigint)` per AC-4.
  - [ ] Add `activate_first_context()` (trigger function) per AC-5, and its trigger:
        `create trigger activate_first_context_trigger after insert on
        public.account_members for each row when (new.status = 'active') execute
        function public.activate_first_context();`. Implement it by calling
        `set_active_context()` internally (same validated write, per the
        single-owner-logic convention — do not duplicate the membership check).
  - [ ] `06_grants.sql`: grant `execute` on both new functions to `authenticated` and
        `service_role`, none to `anon`. Revoke `execute` on the now-deleted
        `current_account_id()` line (it disappears with the function).

- [ ] **Task 3 — Migrate the 17 RLS policies** (AC: 6, 7)
  - [ ] Work `05_policies.sql` table by table using AC-6's list. For 15 of the 17 it is
        a literal token swap (`current_account_id()` → `current_context_id()`) inside
        existing `using`/`with check` clauses — no other change.
  - [ ] `accounts`'s and `account_members`'s policies each get AC-7's corrected shape,
        not the literal swap.
  - [ ] Re-read `interactions`' policy in full before editing it — it has **six**
        occurrences of the old resolver across one `using` and one `with check` clause
        (three each); all six move together or the policy silently diverges between
        read and write.

- [ ] **Task 4 — Add the hardening index** (AC: 8)
  - [ ] `01_tables.sql`: add the partial unique index from AC-8 next to
        `account_members`'s existing indexes.

- [ ] **Task 5 — Migrate the 14 function bodies** (AC: 9)
  - [ ] Work `02_functions.sql` top to bottom using AC-9's list. Each is a literal
        `public.current_account_id()` → `public.current_context_id()` swap inside a
        `v_account_id := …` assignment or an inline `where account_id = …` predicate —
        confirm with `LSP findReferences` on `current_account_id` before editing so no
        call site is missed (`.claude/rules/lsp-usage.md` — this is a SQL function body,
        so also cross-check with the plain-text grep in AC-10, which is the authority
        for SQL since the LSP server covers only `.ts/.tsx/.js/.jsx`).
  - [ ] Update the three prose comments that name `current_account_id()` without calling
        it (today at `02_functions.sql:228`, `:519`, `:1254`, `:2083` — verify against
        the post-1.1–1.6 file before editing, since these line numbers will have moved).

- [ ] **Task 6 — Generate and hand-check the migration** (AC: 12)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        context_aware_authorisation`.
  - [ ] Confirm the diff does **not** render `current_account_id()`'s replacement as a
        silent no-op — a `DROP FUNCTION` for the old signature plus `CREATE FUNCTION`
        for the new name is expected and correct (different name = different object,
        unlike a same-name `CREATE OR REPLACE`).
  - [ ] Re-add every `REVOKE`/`GRANT` the diff drops for the 17 edited policies (it
        regenerates the policy bodies but has a history of dropping the surrounding
        grant statements — see 1.2 Dev Notes precedent) and for the two new functions
        and `member_state`.
  - [ ] Apply with `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up
        --local`. **Never `db reset` and never `db push`.**

- [ ] **Task 7 — Update the surviving non-schema references** (AC: 10)
  - [ ] `supabase/functions/users/index.ts:72` (comment), `supabase/functions/clear_demo/index.ts:19`
        (comment), `supabase/functions/_shared/resolveDemoAccount.ts:27` (comment),
        `supabase/functions/merge_references/index.ts:99` (comment) — reword to name
        `current_context_id()`.
  - [ ] `supabase/tests/billing_entitlement.sql:102,132` and
        `supabase/tests/references_entity.sql:114,224,371,450` — rename the calls. Line
        224 is also being rewritten by story 1.1 for an unrelated reason (dropping
        `tasks.contact_id`); whichever of 1.1 or this story lands second in an
        implementation pass must re-verify that line rather than assume the other's
        untouched text.
  - [ ] `references_entity.sql:371` ("RLS: tenant B resolves to its own account") and
        `:450` (the fail-closed "returns null with no membership" case) are this
        story's direct precedent — read them before writing Task 8's new suite so the
        new tests extend the same pattern rather than inventing a second one.

- [ ] **Task 8 — New test suite + negative tests** (AC: 3, 6, 7, 11)
  - [ ] `supabase/tests/context_resolution.sql` + `.test.ts`, same shape as
        `references_entity.sql`/`.test.ts` (temp `results`/`ids` tables, one row per
        check, `psql -f -` runner, `npm run test:unit:db`). Cover AC-11's three cases in
        full, plus: `member_state` cannot be written directly by `authenticated` (AC-3),
        `account_members`'s corrected policy hides a foreign member's row in an inactive
        context while still showing the caller's own (AC-7), and the
        `activate_first_context` trigger auto-activates a first membership but leaves a
        second one alone (AC-5).
  - [ ] Do not duplicate `references_entity.sql`'s existing tenant-isolation checks —
        this new file is specifically about **one user, multiple contexts**, which no
        existing file covers.

- [ ] **Task 9 — Verify** (AC: 10, 13)
  - [ ] Run the AC-10 greps; both must be empty.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.
  - [ ] `npx prettier --config ./.prettierrc.json --check` over this story's changed
        files only.

## Dev Notes

### Why `order by am.id limit 1` is the whole epic's blocker

> "`public.current_account_id()` resolves a user to one arbitrary account (`order by
> am.id limit 1`) and every RLS policy depends on it. Personas and contexts are
> unbuildable until it is rewritten (Epic 2)."
> [Source: _bmad-output/planning-artifacts/epics.md#Overview]

The current function (`supabase/schemas/02_functions.sql:527-543`) already has a
fail-closed comment explaining the **previous** bug it fixed (falling back to account
#1 when the caller had no membership at all) — but it still has exactly one row's worth
of context-awareness: `order by am.id limit 1` picks whichever membership row sorts
first, with zero regard for which one the user actually wants active. FR83/FR84 (two
context types, active context explicit and never inferred) and AD-19 are not
implementable on top of that function; they require it to consult a **held choice**,
which is what `member_state` is for.

### The naming collision this story does not resolve — and does not need to

1.2 (`sales`→`members`) flagged that `public.members` (the profile table) and
`public.account_members` (the membership/role table the glossary calls "member") now
sit one word apart, and explicitly punted resolving it to Epic 2:

> "If the planner wants the collision resolved rather than documented, that is Epic 2
> work (`current_context_id()` / AD-19 rewrites the membership model anyway) — raise
> it, do not invent a third name."
> [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md#Naming-collision]

This story does not rename either table. `member_state` and `set_active_context()` are
named for what AD-19 already calls them, and both operate on `account_members`, not
`members`. **Decision:** leave the collision exactly as 1.2 documented it (a `comment on
column public.tasks.member_id` pointing at `members`, everything else pointing at
`account_members`) — inventing a third name here would be scope creep this story's own
ACs do not ask for. Flagged again in the epic-level report for whoever owns the
decision to ever actually resolve it.

### What this story deliberately does not touch

- **`public.members`'s `using (true)` read policy.** Every authenticated user can read
  every profile row today; that predates this story and 1.2 explicitly preserved it
  ("Hardening `members` … account-scoping the read … is AD-1 / Epic 2, explicitly not
  this story" — referring to *1.2*, not this one). Tightening it needs the persona/context
  model this story does not build (you cannot scope "who shares a context with me"
  without `accounts.kind` and the persona vocabulary) — it is **Story 2.2's** to do, and
  2.2's Dev Notes should cite this paragraph rather than re-derive the reasoning.
- **`is_admin()` / `configuration`.** AD-2 says "retire `is_admin()`/`isInitialized`."
  `isInitialized` is Story 2.7's (it dies with the invite-only signup gate).
  `is_admin()` gates the single global `configuration` row (`01_tables.sql:142-146`), a
  platform-wide singleton with no `account_id` at all — it sits outside AD-2's
  household/shadchanus/role vocabulary entirely (there is no "platform superadmin" role
  in that vocabulary). **Decision: leave `is_admin()` in place.** None of Epic 2's eight
  stories' stated ACs give it a replacement, and inventing a platform-admin role to
  retire it would be scope beyond what was asked. This is flagged to the epic owner as
  an AD-2 directive with no assigned story — not resolved here, not silently dropped.
- **`FORCE ROW LEVEL SECURITY`.** AD-1 calls for it on every table; none of today's
  tables have it (`alter table … enable row level security` only, never `force`). No
  story in Epic 2's stated text asks for a table-by-table FORCE-RLS audit, and — because
  `anon` is granted nothing on any domain table before or after this story (verified:
  `grep -n "anon" 06_grants.sql` shows no domain-table grant surviving Epic 1) —
  `FORCE ROW LEVEL SECURITY`'s practical effect here is defense-in-depth against a
  future accidental grant, not a live gap this story's own negative tests exercise.
  `member_state` (new in this story) gets ordinary RLS, matching every other table
  added so far; a repo-wide FORCE-RLS pass is flagged as an AD-1 gap with no assigned
  story, same as `is_admin()` above.

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

### Verified call sites (counted against `main` @ `8ad49cb`, 2026-07-26)

**17 policies** call `current_account_id()` today (AC-6's table, using the pre-rename
names `Children scoped to account` on `children` and reading `sales`/`Enable read
access…` as out of scope since it never calls the resolver at all).
`grep -c current_account_id supabase/schemas/05_policies.sql` → 41 raw occurrences
across those 17 policies (`interactions` alone contributes 6; every other policy
contributes 1–2 for its `using`/`with check` pair).

**14 functions** call it in their bodies (AC-9's list).
`grep -c current_account_id supabase/schemas/02_functions.sql` → 21 raw occurrences:
1 in the deleted function's own definition site (not a call), 3 in prose comments, the
remaining spread across the 14 function bodies (most call it once into a
`v_account_id` local; none call it more than once).
`set_child_portal_token_defaults()` also calls it today but is deleted whole by story
1.4 (retire token portal) — excluded from AC-9's count because it will not exist by the
time this story runs.

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
  `06_grants.sql`, `01_tables.sql` by hand.
- Function bodies must match `pg_dump` formatting exactly (`npx supabase db dump
  --local --schema public`) or the next `db diff` reports a phantom diff. Copy the
  existing `SET "search_path" TO ''` / `SECURITY DEFINER` quoting style verbatim from
  `current_account_id()`'s own definition when writing `current_context_id()`.

### Security posture — this is the definitive `.claude/rules/security-triggers.md` case

This story touches authentication-adjacent authorization, every RLS policy in the
product, and a new `SECURITY DEFINER` function pair. A security review is not optional.
The two things a reviewer should specifically hunt for: (1) any policy left calling the
deleted function (a straight `to_regproc`/grep check settles it, AC-1/AC-10), and (2) any
path that writes `member_state` other than through `set_active_context()` (AC-3's
"no insert/update policy" is the actual enforcement — verify by attempting a raw
`update` as an ordinary authenticated role and confirming it is denied, not merely
untested).

### Testing standards

- SQL/RLS tests: `supabase/tests/<name>.sql` + `<name>.test.ts`, run via `npm run
  test:unit:db` against the local stack (`make start` first). Follow
  `references_entity.sql`'s shape exactly: a `results` temp table
  (`name, passed, detail`), one row per assertion, `on commit drop`, the whole file
  wrapped in `begin;`/(implicit) rollback so nothing persists; the `.test.ts` shells out
  to `psql` and turns each row into a named `it()`. Do not invent a second test harness
  shape.
- `.claude/rules/testing.md`: AAA structure, no shared mutable state between tests, no
  `waitForTimeout`-style flakiness (n/a here — this is DB-only, no Playwright).
- `.claude/rules/security-triggers.md`: mandatory negative test for any RLS-touching
  change — AC-11 is that test.

### Project Structure Notes

No new frontend surface in this story — it is schema-only (`supabase/schemas/*.sql`,
`supabase/migrations/*.sql`, `supabase/tests/*.sql`+`.test.ts`). It changes no `src/`
file. Downstream stories (2.2 onward, plus the frontend context switcher in 2.4) are
what consume `current_context_id()`/`set_active_context()`.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-19] — `member_state`, `current_context_id()`,
  `set_active_context()`, fail-closed, "accepted cost: one active context per user, not
  per browser tab."
- [Source: ARCHITECTURE-SPINE.md#AD-1] — tenant isolation is scope + RLS, deny-by-default,
  FORCE RLS / anon-revoke posture (flagged above as not this story's to complete).
- [Source: ARCHITECTURE-SPINE.md#AD-2] — "Retire `is_admin()`/`isInitialized`" (partially
  addressed: `isInitialized` is 2.7's; `is_admin()` flagged, not resolved).
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "The active context
  is a server-side row, chosen explicitly … a client-supplied context is never trusted."
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-two-context-types]
  — "One active at a time … the active context is a server-side row."
- [Source: supabase/schemas/02_functions.sql:512-543] — the current `current_account_id()`
  and its own fail-closed history, read in full before writing the replacement.
- [Source: supabase/schemas/05_policies.sql] — the complete current RLS surface; every
  policy in AC-6's table was read from this file line by line, not assumed.
- [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md#Naming-collision]
  — the `members`/`account_members` collision, explicitly punted here and not resolved.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
