---
baseline_commit: cd253d5935e7cef5b89404c41c798d681069affb
---

# Story 2.2: Persona and Context Data Model

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want personas and contexts modelled explicitly in the schema,
so that provisioning a persona and authorising against a context both read from one
source of truth instead of each screen inventing its own rule.

## Written against the post-Epic-1 tree

Epic 1 has **landed and deployed**. Every fact, line number and count below was
re-verified against `main` @ `c711266` (2026-07-27), after 1.1–1.6. Concretely, the
world this story targets:

- `sales` → **`members`**; `children` → **`singles`**; `child_id` → **`single_id`**;
  `sales_id` → **`member_id`**.
- The fork fossils (contacts, companies, deals, deal_notes, contact_notes, tags,
  favicons_excluded_domains) and the token portal (`portal/`, `child_portal_tokens`,
  `get_child_portal()`) are **gone**, with their views, policies, grants and triggers.
- Route/resource registration is a **manifest** —
  `src/components/atomic-crm/root/routeManifest.ts` — mapped over by `DesktopAdmin` /
  `MobileAdmin`. There is no `<Resource>` / `<Route>` JSX to edit. (This story edits no
  `src/` file at all; the manifest matters only to Task 5's audit.)
- Two new CI guards exist and gate every change:
  `node scripts/check-retired-names.mjs` (scans `supabase/schemas`, `supabase/tests`,
  `src`, … for retired vocabulary — **it reads `.sql` too**) and
  `node scripts/check-suppressions.mjs`.

⚠️ **The `member_id` name collides; the referent does not.** `tasks.member_id` points at
`public.members` (the user/profile table, FK-less by design —
`01_tables.sql:53-58`). `singles.member_id`, `shidduchim.owner_member_id` and
`interactions.actor_member_id` point at **`public.account_members`** (the membership
table) via real FKs (`01_tables.sql:525,543,598`). Everything this story writes touching
`singles.member_id` means an **`account_members.id`**, never a `members.id`. Wiring it to
the profile table would compile, pass every existing test, and silently break every
persona predicate.

## Dependencies

**Requires Story 2.1 (hard).** Every RLS predicate this story writes calls
`current_context_id()`; the `accounts` / `account_members` "own rows always visible"
shapes this story relies on (to know which contexts a caller belongs to before
provisioning a new one) are 2.1 AC-7. Neither `current_context_id()` nor
`public.member_state` exists on `main` today — the resolver is still
`public.current_account_id()` (`02_functions.sql:146-162`, `order by am.id limit 1`).
Do not start this story until 2.1's migration is applied.

**Feeds 2.3, 2.4, 2.5.** 2.3 (onboarding) and 2.5 (lifecycle changes) both call this
story's `add_persona()` — they do not reimplement provisioning. 2.4 (context switcher)
reads `accounts.kind` to label contexts "Household" vs "Shadchanus" and calls
`public.my_personas()` (this story) to decide whether to render a switcher at all.

## Acceptance Criteria

1. **A context has a kind, and it isn't a guess.** `public.accounts` (today
   `01_tables.sql:104-124`, **no `kind` column**) gains `kind text not null default
   'household' check (kind in ('household', 'shadchanus'))`. Every account created before
   this migration becomes `'household'` (correct: no shadchanus context exists yet in this
   codebase — Epic 8 is the first consumer of the type beyond this story's own
   provisioning function). Decided by: `\d public.accounts` shows the column and the
   check; `select count(*) from public.accounts where kind <> 'household'` returns 0
   immediately after migration.

2. **`single` is a real role, matching AD-2 exactly.** `account_members_role_check`
   becomes `role in ('parent_admin', 'single', 'helper', 'self_manager', 'shadchan')` —
   today it is `role in ('parent_admin', 'helper', 'self_manager', 'shadchan')`
   (`01_tables.sql:139-141`), **missing `single` entirely**, which means the role the
   glossary calls "a single with their own login" (personas-and-contexts.md shape 5)
   cannot currently be assigned to anyone.

3. **A shadchanus context cannot hold a household domain row — enforced by Postgres,
   not by convention.** One shared trigger function, `public.enforce_household_scope()`
   (`before insert or update of account_id` — the update event too, so a row can never be
   *moved* onto a shadchanus account by any write path RLS does not stop, e.g. a
   service-role caller; one function reused across every table per the single-owner-logic
   convention — mirrors `purge_polymorphic_dependents()`'s existing pattern), raises
   unless `exists (select 1 from public.accounts where id = new.account_id and kind =
   'household')`. A NULL `new.account_id` therefore also raises — that is deliberate and
   fail-closed (see AC-3a for why it can only ever be NULL in a genuinely broken case).

   Attached to all **13** household-only domain tables — the same 13, exactly, that
   already carry a `set_account_id_default` trigger in `04_triggers.sql`: `singles`,
   `shadchanim`, `"references"`, `shidduchim`, `resumes`, `reference_links`,
   `date_records`, `redts`, `shidduch_schools`, `interactions`, `identity_signals`,
   `inbox_items`, `tasks`. A negative test inserts a row into each with a
   `shadchanus`-kind `account_id` and confirms every one of the 13 raises.

   Decided by: `select count(*) from pg_trigger where tgfoid =
   'public.enforce_household_scope'::regproc and not tgisinternal` returns **13**, and
   `grep -c "public.enforce_household_scope()" supabase/schemas/04_triggers.sql` returns
   13.

3a. **The scope trigger must fire *after* `set_account_id_default`, and the trigger name
   is what guarantees it.** Postgres fires same-event BEFORE triggers **in alphabetical
   order by trigger name**. Every normal client insert arrives with `account_id` NULL —
   that is the entire point of `set_account_id_default()`
   (`02_functions.sql:180-190`; the SPA never sends `account_id`, see
   `login/FirstRunSetup.tsx:87-95` creating a `singles` row with only
   `first_name_en`/`gender`/`status`). A trigger named `enforce_household_scope_trigger`
   sorts **before** `set_singles_account_id` (`e` < `s`), would see `new.account_id IS
   NULL`, and would raise on **every legitimate insert into all 13 tables** — a total
   outage, not an edge case.

   Therefore the triggers are named `validate_<table>_household_scope` (`v` sorts after
   every existing BEFORE trigger on these tables — all of which begin `set_` or `sync_`).
   Decided by, for each of the 13:

   ```sql
   select tgname from pg_trigger
   where tgrelid = 'public.singles'::regclass and not tgisinternal and tgtype & 2 = 2
   order by tgname;
   ```

   `validate_singles_household_scope` must sort **last**. And a positive test: an ordinary
   authenticated insert into `singles` with **no** `account_id` supplied still succeeds
   while the caller's active context is a household. Do **not** "fix" this by no-op'ing
   the function on NULL `account_id` — that reopens the hole (`set_account_id_default`
   would then set `account_id := current_context_id()`, which for a shadchanus-active
   caller is the shadchanus account, and nothing would re-check it).

4. **`subscription` and `ai_usage` are deliberately excluded from AC-3's list.** Nothing
   in AD-16 or the SPEC restricts billing/entitlement to household contexts, and no
   story states a shadchan-billing rule one way or the other. Decision: leave both
   scoped generically by `current_context_id()` (any context kind may hold a
   subscription row) rather than guess a restriction nobody asked for. Flagged in Dev
   Notes as an open product question, not silently resolved. Decided by: a one-line
   `comment on table` on each naming this story and the open question, plus their
   absence from AC-3's count of 13.

5. **A `shadchan`-role membership can only ever exist on a shadchanus-kind account —
   also enforced by Postgres, not by convention.** This is the mirror case of AC-3, on
   the membership table itself rather than the domain tables: AD-2 states plainly that
   the `shadchan` role's "access is granted solely through a connection, never through
   household membership" — a `shadchan`-role row on a `household`-kind account would be
   exactly that forbidden path. A new trigger,
   `public.enforce_membership_role_matches_context()` (`before insert or update on
   public.account_members`), raises unless `role = 'shadchan'` implies the account's
   `kind = 'shadchanus'`, and every other role implies `kind = 'household'`. A negative
   test attempts both mismatches (`shadchan` role on a household account; `parent_admin`
   role on a shadchanus account) and confirms both raise.

   `account_members` has **no** BEFORE trigger today, so there is no ordering hazard here
   (2.1's `activate_first_context_trigger` is `after insert`) — but confirm that stays
   true with the same `pg_trigger` query as AC-3a before assuming it.

6. **One function provisions every persona — `public.add_persona(p_persona text)`.**
   `p_persona in ('single', 'parent', 'shadchan')` or it raises. `SECURITY DEFINER`,
   `SET search_path TO ''` — **not** `SECURITY INVOKER`, and this is deliberate, not a
   copy-paste default: the target household for the `single`/`parent` branches is
   whichever one `auth.uid()` already holds an owning membership in, which is **not
   necessarily the caller's currently-active context** (e.g. a user active in their
   shadchanus context ticking "single" to attach to a household they also belong to but
   are not currently viewing). Every domain table's own RLS `with check` is scoped to
   `current_context_id()` (2.1), so a plain `SECURITY INVOKER` insert would be silently
   rejected the moment the target household is not the active one — exactly the
   `set_active_context()` problem 2.1 already solved, recurring here. `add_persona()`
   therefore re-validates membership itself, directly against `account_members` with
   `user_id = auth.uid()`, and never trusts ambient RLS to have already scoped anything
   for it. Idempotent: calling it twice with the same persona for the same caller
   changes nothing the second time. It never switches the caller's active context —
   2.1's `activate_first_context()` handles a user's *first* context and deliberately
   leaves a second one alone; changing the active context is `set_active_context()`'s
   job, called by 2.3/2.4, never a side effect of provisioning.

   Behaviour per persona, matching personas-and-contexts.md's provisioning table exactly:
   - **`parent`** — the branch keys on **owning** memberships (`role in ('parent_admin',
     'self_manager')`) only, never "any household membership": if the caller already
     holds an active `parent_admin` membership, no-op; if they hold an active
     `self_manager` membership, promote it to `parent_admin` (the
     self-managing-single-becomes-parent case — same household, per the "shape 1 + 2
     combined" note); otherwise — including when their only household memberships are
     **non-owning** (`helper` in another family, `single` in their parents' household)
     — create a **new** household (`accounts.kind = 'household'`,
     `account_members.role = 'parent_admin'`). A non-owning membership is never
     promoted: promoting a `helper` would hand them admin of **someone else's**
     household, and promoting a `single`-role child to `parent_admin` of their parents'
     household is the same privilege escalation one generation down. A negative test
     covers exactly this: a `helper`-only caller ticking `parent` gets a fresh
     household and the helped family's membership row is unchanged.
   - **`single`** — if a `singles` row already exists with `member_id` pointing at
     **any** of the caller's own active memberships (`member_id` is an
     `account_members.id` — see the collision warning above), no-op. That is the same
     predicate `my_personas()` (AC-8) reports the `single` persona by, so provisioning and
     reporting cannot diverge (this covers the invited single: `role = 'single'` in
     their parents' household, `singles` row already pointing at them — ticking the box
     they already hold must not create a second household). Otherwise: if the caller
     holds an active household-kind membership with an **owning** role
     (`parent_admin`/`self_manager`), insert a `singles` row in that household with
     `member_id` = that membership's id. If not (no memberships at all, or only
     non-owning `helper` memberships elsewhere — see Dev Notes "Why `single` never
     attaches to a helper's household"), create a new household with
     `role = 'self_manager'`, then the `singles` row inside it.
   - **`shadchan`** — if the caller holds no active `shadchan`-role membership, create a
     new `accounts.kind = 'shadchanus'` and an `account_members` row with
     `role = 'shadchan'`. Otherwise no-op.

7. **Ticking both `single` and `parent` yields one household, not two.** A test calls
   `add_persona('parent')` then `add_persona('single')` for the same caller and asserts
   exactly one household-kind `account_members` row exists for them (`role =
   'parent_admin'`) plus exactly one `singles` row with `member_id` pointing at it —
   never a second household. The reverse order (`single` then `parent`) is also asserted:
   `single` creates a household with `role = 'self_manager'`, and `parent` must then
   **promote that same row** to `parent_admin` rather than create a second household.
   [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3 — "**And** ticking both
   single and parent yields one household containing me and my children."]

8. **`public.my_personas()` is the one query every later screen uses to answer "what am
   I."** `returns table(persona text, account_id bigint, account_kind text, role text)`,
   `STABLE`. **`SECURITY DEFINER`, not `SECURITY INVOKER`** — for the same reason as
   AC-6: it must report a persona held in a context that is not currently active (e.g.
   a `single` persona sitting in a household while the caller is active in their
   shadchanus), and `singles`'s own RLS is scoped to `current_context_id()` only, so a
   plain invoker-rights read would silently omit any inactive context's persona. It
   queries `account_members`/`singles` directly for `user_id = auth.uid()`, bypassing
   ambient RLS exactly as `add_persona()` does, and returns rows for the caller only —
   it is never given a `p_user_id` parameter, so it cannot be used to inspect anyone
   else. Derives — never stores — `shadchan` from an active `shadchan`-role membership,
   `parent` from an active `parent_admin`-role membership, `single` from an active
   `singles` row whose `member_id` matches **any** of the caller's own active
   memberships (covering `self_manager`, the parent-who-is-also-a-single case, and the
   invited single holding a `single`-role membership), matching AC-6's no-op predicates
   exactly so provisioning and reporting never diverge. 2.3, 2.4 and 2.5 all call this
   rather than re-deriving the same predicate three ways. Decided by: `select
   pg_get_function_identity_arguments('public.my_personas'::regproc)` returns the empty
   string, and the output-shape assertions in Task 7.

9. **`members` profile visibility is scoped to "shares a context with me," not
   everyone.** `public.members`'s `Enable read access for authenticated users` policy —
   today the literal `for select to authenticated using (true)` at
   `05_policies.sql:12` — is replaced with: a caller always reads their own row
   (`user_id = auth.uid()`; `public.members.user_id` is `not null` and uniquely indexed,
   `01_tables.sql:20,25`), plus any other `members` row belonging to a user who shares an
   **active** membership in any of the caller's own active contexts. A negative test
   proves a user in household A cannot read the profile row of a user who belongs only to
   household B.

9a. **The `src/` audit for AC-9 produces a written finding list, and this story fixes
   none of it.** Task 5 audits every `public.members` read and records the result in the
   Completion Notes. The complete set on `main` @ `c711266` is four Supabase-backed
   reads (the rest of `grep -rn '"members"' src/`'s **16** hits are the FakeRest
   provider, which has no RLS, a `beforeSave` hook, a `CanAccess` guard and the route
   manifest):

   | # | Site | Shape | Survives AC-9? |
   |---|---|---|---|
   | 1 | `providers/supabase/authProvider.ts:70-74` | `.from("members").match({ user_id: <own> }).single()` | yes — own row |
   | 2 | `settings/ProfileSection.tsx:29` | `useGetOne("members", { id: identity?.id })` | yes — own row |
   | 3 | `members/MemberList.tsx` (`/members`, registered `routeManifest.ts:120`, `surface: "desktop"`) | `getList` over all rows | yes — narrows to context-sharing members, which is the intent |
   | 4 | `members/MemberEdit.tsx` / `MemberCreate.tsx` | `getOne` / `create` on the same list | yes — same predicate |

   `e2e/fixtures.ts:56` also reads `members`, but through the **service-role** admin
   client, which bypasses RLS — unaffected. Any site found *not* to survive is a finding
   to report to the epic owner, never a fix to make silently inside this ticket.

10. **RLS prevents any cross-context read** — the epic's own AC text for this story,
    verified concretely rather than left as a slogan: a member of household A querying
    `singles`, `shidduchim`, `references`, `tasks` and `members` while household B holds
    rows of each returns zero from B in every case (this reuses/extends 2.1's
    `context_resolution.sql` suite rather than duplicating its setup — see Task 7).

11. **No alias, shim or second provisioning path survives** (NFR-14) — stated as
    something a grep can settle. Specifically: after this story, `insert into
    public.accounts` appears in `supabase/schemas/*.sql` exactly **twice** —
    `handle_new_user()`'s first-user bootstrap (`02_functions.sql:64`, which only fires
    when `account_members` is empty) and `add_persona()`. No new SQL function, edge
    function or `src/` call site creates an account. `supabase/migrations/*.sql` and
    `supabase/tests/*.sql` are excluded from that count (frozen history and fixtures
    respectively). No `kind` value beyond `household`/`shadchanus` is ever introduced.

    **Scope note — "no second path" is about *account* creation, not about `singles`
    rows.** Inserting a `singles` row is an ordinary product action with legitimate
    non-persona writers today (`login/FirstRunSetup.tsx:87-95` for the first child,
    `supabase/functions/seed_demo/index.ts:130` for demo data, the normal
    `dataProvider.create("singles", …)` path everywhere else). The invariant this AC
    asserts is that **provisioning a persona** — household + membership + the caller's
    *own* `singles` row — happens only in `add_persona()`; 2.3's onboarding UI and 2.5's
    settings UI call it rather than performing their own `insert into public.accounts`.

12. **Toolchain green.** Run, all passing:
    `npm run typecheck` (== `make typecheck`), `npm run lint` **and** `npm run prettier`
    (together == `make lint`, a real repo-wide gate since Story 1.6), `npm run test`
    (== `make test`; already includes the `db` vitest project), and — with the local
    stack up (`make start-supabase`) — `npm run test:unit:db`. Plus the two CI guards
    added by 1.6: `node scripts/check-retired-names.mjs` and
    `node scripts/check-suppressions.mjs`.

    **Prettier note (do not chase this):** prettier's glob is
    `**/*.{mjs,js,json,ts,tsx,css,md,html}` — **`.sql` is not in it**. This story's
    schema changes are therefore outside prettier entirely; the only file it creates
    that prettier sees is `supabase/tests/context_resolution.test.ts` (2.1's, extended
    here). A scoped `npx prettier --config ./.prettierrc.json --check` over the changed
    `.sql` files would be vacuously green and prove nothing.

## Tasks / Subtasks

- [x] **Task 1 — `accounts.kind` and the `single` role** (AC: 1, 2)
  - [x] `supabase/schemas/01_tables.sql`: add the `kind` column to `accounts`
        (`104-124` today, AC-1) and extend `account_members_role_check` (`139-141`
        today) to include `single` (AC-2).

- [x] **Task 2 — Household-scope + role/context enforcement triggers** (AC: 3, 3a, 4, 5)
  - [x] `supabase/schemas/02_functions.sql`: add `enforce_household_scope()` per AC-3
        and `enforce_membership_role_matches_context()` per AC-5. Copy
        `purge_polymorphic_dependents()`'s quoting/formatting style verbatim
        (`02_functions.sql:818-836`) — `pg_dump` format or the next `db diff` reports a
        phantom diff (AGENTS.md).
  - [x] `supabase/schemas/04_triggers.sql`: attach the household-scope trigger
        (`before insert or update of account_id`) to each of the 13 tables in AC-3,
        naming each one `validate_<table>_household_scope` so it sorts **after**
        `set_<table>_account_id` — read AC-3a before writing a single line of this,
        it is the difference between a working migration and a total insert outage.
        Do **not** attach it to `subscription`/`ai_usage` (AC-4) — add a one-line
        `comment on table` on both recording the decision and pointing at this story,
        so the omission reads as deliberate to the next developer, not missed. Attach
        `enforce_membership_role_matches_context_trigger` (`before insert or update`)
        to `account_members`.
  - [x] Cross-check the 13 against the file itself:
        `grep -c "execute function public.set_account_id_default()" supabase/schemas/04_triggers.sql`
        returns 13 and lists exactly AC-3's tables — this story's list is defined to be
        that same set, so a divergence means one of the two is wrong.
  - [x] `06_grants.sql`: for both new trigger functions, `revoke all on function …
        from public, anon;` then grant `execute` to `authenticated` and `service_role`
        — Postgres grants EXECUTE on a new function to PUBLIC by default, so "no anon
        grant" alone is not deny; the file's own revoke-then-grant pattern is (copy
        `current_account_demo()`'s block, `06_grants.sql:201-204`). Neither
        is `SECURITY DEFINER` — each only reads `accounts.kind` for the row it is
        validating, which the inserting/updating member's own RLS already lets them
        read.

- [x] **Task 3 — `add_persona()`** (AC: 6, 7, 11)
  - [x] `supabase/schemas/02_functions.sql`: implement per AC-6's three branches, as
        `SECURITY DEFINER` / `SET search_path TO ''`. Query `account_members`/`singles`
        directly filtered to `user_id = auth.uid()` — never rely on `current_context_id()`
        or on RLS having already scoped a read, since the target context may not be
        active (AC-6's rationale). Do not query across other users' rows at all.
  - [x] `singles.member_id` takes an **`account_members.id`**
        (`singles_member_id_fkey`, `01_tables.sql:525`), not a `members.id`. Re-read the
        collision warning at the top of this story before writing that insert.
  - [x] For the household-creation paths (both branches), default the new household's
        `accounts.name` from the caller's `public.members` row (e.g. `"<first_name>'s
        Family"`), falling back to the column's own `'My Account'` default if the
        profile has no name yet. (There is no naming precedent to copy:
        `login/FirstRunSetup.tsx`'s "account" step *renames* the bootstrapped account
        via a form — placeholder `"The Klein Family"`, `FirstRunSetup.tsx:181` — it never
        generates a default. 2.3 keeps that rename step for the `parent` path, so this
        default only has to be presentable, not final.)
  - [x] `06_grants.sql`: `revoke all on function … from public, anon;` then grant
        `execute` to `authenticated` (the standard pattern — see Task 2's note).

- [x] **Task 4 — `my_personas()`** (AC: 8)
  - [x] Implement per AC-8 as `SECURITY DEFINER` / `SET search_path TO ''`, sharing the
        exact same "owning role" / "singles row via member_id" predicates Task 3 uses —
        if a future edit changes one, changing the other is not optional. Factor the
        shared "is this an owning role" test (`role in ('parent_admin', 'self_manager')`)
        into one small `IMMUTABLE` SQL function used by both, rather than repeating the
        literal list twice.
  - [x] `06_grants.sql`: `revoke all on function … from public, anon;` then grant
        `execute` to `authenticated` (see Task 2's note). Because this
        function is `SECURITY DEFINER` and reads across all of `auth.uid()`'s rows
        regardless of RLS, double-check it takes **no** parameter that could target
        another user — the function signature itself is the only guard, so get the
        signature right (`my_personas()`, no arguments) rather than relying on a body
        check that a future edit could loosen.

- [x] **Task 5 — Tighten `members`'s read policy, then audit its consumers** (AC: 9, 9a)
  - [x] `05_policies.sql:12`: replace `Enable read access for authenticated users` on
        `public.members` with AC-9's predicate.
  - [x] Confirm no existing consumer breaks: `grep -rn '"members"' src/` (16 hits today)
        plus `grep -rn 'from("members")' src/`, and walk AC-9a's table. Note the resource
        is registered in the **manifest** (`root/routeManifest.ts:120`,
        `{ name: "members", surface: "desktop", definition: members }`) — there is no
        `<Resource name="members">` JSX anywhere since Story 1.5. Flag, do not silently
        work around, any call site that assumed the old unscoped visibility. Record the
        result in Completion Notes.
  - [x] **Report, do not fix — `getCurrentAccountId()`
        (`providers/supabase/dataProvider.ts:607-618`).** It resolves "the caller's
        account" with `.from("accounts").select("id").limit(1).maybeSingle()`, whose
        comment still asserts "`accounts` is RLS-scoped to the caller, so this returns
        their own account and nothing else." That stops being true under 2.1 AC-7 (a
        caller sees **every** account they hold membership in), and this story is what
        makes a second context reachable in production. The value namespaces attachment
        object keys, which `07_storage.sql`'s three `storage.objects` policies then check
        against `current_context_id()` — so a first-row pick means uploads are rejected
        or land under the wrong prefix. Not this story's to fix (schema-only, no `src/`
        edits): record it in Completion Notes and raise it to the epic owner as
        **2.4's** (the context-switcher story, which owns the client-side notion of "the
        active context").

- [x] **Task 6 — Migration** (AC: 1, 2, 3, 3a, 5, 6, 8, 9)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        persona_context_data_model`, hand-check per the same cautions as 2.1's Task 6
        (`db diff` drops `security_invoker` and `REVOKE`/`GRANT` lines around a function
        it regenerates), then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        **Never `db reset --local`** (destructive) and **never `db push`** (the
        deploy-time round, owned by the orchestrator).
  - [x] `db diff` emits triggers in its own order — confirm by hand that the generated
        migration creates each `validate_*_household_scope` trigger with exactly the
        name AC-3a specifies. The name **is** the ordering guarantee; a rename in the
        migration is a silent outage.

- [x] **Task 7 — Tests** (AC: 3, 3a, 5, 7, 10, 12)
  - [x] Extend `supabase/tests/context_resolution.sql` + `context_resolution.test.ts`
        (created by 2.1) rather than starting a third RLS test file for this domain —
        same `results`/`ids` temp-table shape, one `it()` per row, run via
        `npm run test:unit:db`. Add: the 13-table `enforce_household_scope` negative test
        (AC-3), the **positive** "insert with no `account_id` still succeeds on all 13"
        test that proves trigger ordering (AC-3a), the role/context-mismatch negative
        test (AC-5), the `add_persona()` idempotency and single-household checks in both
        orders (AC-7), the two non-owning-membership negative tests (a `helper`-only
        caller ticking `parent` gets a new household, never a promotion; an invited
        `single`-role member ticking `single` is a no-op, never a second household —
        AC-6), `my_personas()` output-shape checks (AC-8), and the `members`
        visibility negative test (AC-9/10).
  - [x] Run AC-12's full command list.

## Dev Notes

### Refresh log — what moved since this story was first written

This story predates Epic 1. Re-verified against `main` @ `c711266`:

| Claim as written | Reality on `main` @ `c711266` |
|---|---|
| `accounts` at `01_tables.sql:237-257` | `01_tables.sql:104-124` (the file lost the 7 fossil tables) |
| `account_members_role_check` at `01_tables.sql:271-273` | `01_tables.sql:139-141` |
| `purge_polymorphic_dependents()` at `02_functions.sql:1199-1217` | `02_functions.sql:818-836` |
| `member_state` listed as an existing table with an `account_id` | **does not exist** — 2.1 creates it, with `user_id` / `active_account_id` / `updated_at` and no `account_id` column at all |
| "ticking both single and parent yields one household" sourced to personas-and-contexts.md | the sentence is in `_bmad-output/planning-artifacts/epics.md:377` (Story 2.3's AC). personas-and-contexts.md's nearest text is the "shape 1 + 2 combined" note at lines 70-72, which this story also cites |
| `grep -rn '"members"' src/` "(post-1.2 rename)" | rename landed; the grep returns **16** hits, of which **4** are Supabase-backed reads (AC-9a) |
| toolchain = `make typecheck && npm run lint && make test && npm run test:unit:db` + scoped prettier | `make lint` is now a real repo-wide gate (1.6), `make test` already includes the `db` project, and **two new CI guards** exist (`check-retired-names.mjs`, `check-suppressions.mjs`). Scoped prettier over `.sql` is vacuous — `.sql` is outside prettier's glob |

Unchanged and re-confirmed: `accounts` still has no `kind` column; `single` is still
missing from the role check; the 13 household-only tables are still exactly 13 (and are
exactly the set carrying `set_account_id_default`); `members`'s read policy is still
`using (true)`; `purge_polymorphic_dependents()` is still the one-function-many-tables
precedent. **Nothing in this story was already delivered by Epic 1** — every AC is still
open work.

### The trigger-ordering trap (AC-3a) — read before Task 2

This is the one change in this story that can take the whole product down on migration,
and it looks like a naming nit. `set_account_id_default()` is what makes
`dataProvider.create("singles", { data: { first_name_en, gender, status } })` work at all
— the SPA never sends `account_id` (AD-1: never trust a client-sent account id). Postgres
fires BEFORE triggers in **alphabetical name order**, so any enforcement trigger whose
name sorts before `set_…` sees `new.account_id IS NULL`, fails its `exists(...)` check,
and raises. Every insert into all 13 tables would fail. The fix is the name, not a null
guard — a null guard would let `set_account_id_default()` stamp
`account_id := current_context_id()` afterwards with nothing left to check it, which is
precisely the hole AC-3 exists to close.

### The three `storage.objects` policies — not this story's, but do not lose them

Commit `31183f2` made the `attachments` bucket private and added
`Attachments readable within account`, `Attachments writable within account` and
`Attachments deletable within account` to **`supabase/schemas/07_storage.sql`** — a
different schema file from every other policy in the product. They call the resolver.
Story **2.1** migrates them to `current_context_id()`; this story neither adds nor edits
a storage policy. Verify the hand-off held rather than assuming it:
`grep -c current_account_id supabase/schemas/07_storage.sql` must be **0** before this
story starts (it is **3** on `main` today). Their existence is also why Task 5's
`getCurrentAccountId()` finding matters — that client helper picks the prefix these three
policies validate.

### Why `add_persona()` and `my_personas()` are `SECURITY DEFINER`

This is the design decision in this story most likely to be gotten wrong by following
the "obvious" default. `SECURITY INVOKER` looks safer at first glance — it runs with the
caller's own privileges, so it "can't do anything they couldn't already do." But every
domain table's RLS (post-2.1) is scoped to `current_context_id()`, the **currently
active** context, not "any context the caller belongs to." Both functions need to read
and write against a context that is not guaranteed to be the active one (a user parked
in their shadchanus adding the `single` persona to a household they also belong to; a
user checking `my_personas()` while active anywhere). Under `SECURITY INVOKER`,
`add_persona()` would silently fail its own inserts (rejected by the target table's
`with check`) the moment the target context isn't active, and `my_personas()` would
silently under-report. `SECURITY DEFINER` bypasses that — and is made safe the same way
`current_context_id()`/`set_active_context()` already are in 2.1: every query inside is
explicitly filtered to `user_id = auth.uid()` (never a parameter, never another user's
id), so bypassing RLS never becomes bypassing the tenant boundary. This is the exact
same reasoning 2.1 already established for `set_active_context()`; this story is not
inventing a new pattern, it is applying the one 2.1 set.

### The provisioning table this story implements, verbatim

| Persona | Means | Provisions |
|---|---|---|
| single | I am looking for a shidduch for myself | A household (if none) **and a `singles` row pointing at me** |
| parent | I am looking for a shidduch for my children | A household, then prompts to add my singles |
| shadchan | I am a matchmaker | A **separate shadchanus context** |

[Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-three-personas]

"a widow managing both herself and her children is *one* household containing a `singles`
row for herself and rows for each child" —
[Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#The-six-canonical-family-shapes]
(the "shape 1 + 2 combined" note). The user-facing phrasing of the same rule — "ticking
both single and parent yields one household containing me and my children" — is
[Source: _bmad-output/planning-artifacts/epics.md#Story-2.3].

### Why `single` never attaches to a helper's household

A `helper` is "someone a family brings in to assist, with less access than a parent"
[Source: _bmad-output/specs/spec-myshadchan/glossary.md#Identity-and-access] — not a
family member being redt for. If a helper in the Klein household also personally wants
to use MyShadchan for their own search, adding a `singles` row for them **inside the
Klein household** would be wrong on its face (they are not a Klein).
`add_persona('single')`'s **creation** path therefore only ever attaches to an
**owning** membership (`parent_admin` or `self_manager`) — a `helper` membership is
never a target, and a fresh household is created instead. The **no-op** check is
deliberately broader (any own membership, matching `my_personas()`): an invited single
already *has* the persona in their parents' household and must not be given a second
household for re-ticking a box they hold. The same owning/non-owning line governs the
`parent` branch: a non-owning membership is never promoted (a helper must not become
admin of the family they help), only `self_manager` promotes in place. This is a real
design decision, not an oversight.

### Why `shadchan` role and household `kind` may never mix (AC-5)

AD-2, verbatim: "`shadchan` is active, not deny-only — its access is granted solely
through a connection (AD-20), **never through household membership**." A `shadchan`-role
row on a household account would be precisely that forbidden path — it would make a
shadchan a member of a family's own account, which is the exact leak the household/
shadchanus split (personas-and-contexts.md: "if their book lived inside a household
account, that family's account would contain other families' data") exists to prevent.
This is not a hypothetical: `add_persona('shadchan')` (AC-6) only ever creates a
shadchanus-kind account for the role, but nothing before this story stopped a future
bug — a hand-written migration, a bad edge-function insert — from attaching `role =
'shadchan'` to a household row directly. AC-5's trigger makes that structurally
impossible, matching AD-1/AD-2's own "enforced by CI and by scope checks" language.

### Decisions this story settles — and the ones it leaves open

- **A login holding two household-kind contexts is allowed, and AC-6's `parent` branch
  provisions it.** AD-2 states a login "may hold memberships of several contexts
  simultaneously" with no restriction on kind. The lifecycle jump — a `single`-role
  member of their parents' household later marries and becomes a parent — is exactly
  AC-6's non-owning case: `add_persona('parent')` creates them a **new** household
  (their non-owning membership is never promoted), and the context switcher (2.4)
  handles the rest. Their old `singles` row stays in their parents' household, so the
  SPEC's separate out-of-scope item ("a **single** belonging to more than one
  household" — about the `singles` row, not the login) is untouched by this decision.
- **`account_members.status` stays an unconstrained text column in this story.** The
  only value any code writes is `'active'`; Story 2.5 introduces `'archived'` and adds
  the check constraint in the same change, so the constraint and its second value land
  together rather than a speculative constraint landing here first.
- **The `member_id` *column* collision stays documented, not renamed.** 1.2 punted
  "resolving the collision is Epic 2 (AD-19), not this story" onto Epic 2, and 2.1
  closed the *table*-name half (`members` and `account_members` are both
  contract-mandated names, AD-23 and AD-2). The column half is the same answer: the
  `comment on column public.tasks.member_id` breadcrumb 1.2 left
  (`01_tables.sql:53-58`) is the resolution. Renaming `tasks.member_id` would be a
  breaking change with no AD behind it. Nothing further is owed by any story.
- **Left open — whether a shadchanus context may hold a `subscription`/`ai_usage` row**
  (AC-4). No source resolves this either way; excluding both from
  `enforce_household_scope()` is the conservative (does-not-block) choice, reversible
  later without a data migration since no shadchanus-scoped subscription rows can exist
  yet (Epic 8 is the first thing that creates a shadchanus context in a real user's
  hands). Flagged for the product owner; nothing in Epic 2 blocks on it.
- **Left open — whether a shadchanus context may ever hold a non-`shadchan` role.**
  AC-5 hard-codes "every role other than `shadchan` implies `kind = 'household'`", which
  makes a shadchan's assistant (a `helper` inside a shadchanus context) structurally
  impossible. Nothing in Epics 1–11 asks for one — Story 8.1's `SHADCHANUS_NAV` ships a
  single-operator workspace and 8.5 builds the shadchan's own CRM without a second seat
  — so AC-5 as written matches every planned surface. Flagged so the constraint is a
  recorded decision rather than an accident discovered in Epic 8; relaxing it later is a
  one-line change to the trigger and no data migration.

### Security posture

Two new `SECURITY DEFINER` functions, two new enforcement triggers, and one RLS-policy
tightening (`members`) make this a `.claude/rules/security-triggers.md` case — a
security review is expected. The specific things to hunt for: (1) confirm neither
`add_persona()` nor `my_personas()` ever takes or trusts a caller-supplied user/account
identifier — both must derive everything from `auth.uid()` alone, exactly as
`current_context_id()`/`set_active_context()` do; (2) confirm
`enforce_membership_role_matches_context()` fires on `update` as well as `insert` — a
role *change* on an existing row (e.g. a future story promoting someone) must be checked
too, not just the initial insert; (3) confirm the household-scope trigger fires on
`update of account_id` as well as `insert`, so a row cannot be *moved* onto a shadchanus
account; (4) confirm AC-3a's ordering — an enforcement trigger that never sees a real
`account_id` is not enforcement, it is an outage or, if "fixed" with a null guard, a
bypass.

### Verified current state (checked against `main` @ `c711266`, post-Epic-1)

- `accounts` has no `kind` column (`01_tables.sql:104-124`).
- `account_members_role_check` is `role in ('parent_admin', 'helper', 'self_manager',
  'shadchan')` — **`single` is missing** (`01_tables.sql:139-141`), confirmed against
  AD-2's rule text (`parent_admin | single | helper | self_manager | shadchan`) and
  against personas-and-contexts.md's "Roles within a context" list (line 84), which
  independently states the same five.
- The 13 household-only tables in AC-3 are every table in the current schema with a
  non-null `account_id` FK to `public.accounts` **except** `accounts` and
  `account_members` (the context/membership tables themselves), `pipeline_transitions`
  and `configuration` (non-tenant reference/global data — confirmed neither has an
  `account_id` column at all), and `subscription`/`ai_usage` (AC-4's explicit carve-out).
  Independently confirmed: that set is *identical* to the 13 tables carrying a
  `set_account_id_default` trigger in `04_triggers.sql`. `member_state` is not on the
  exclusion list because it does not exist yet — 2.1 creates it, keyed by `user_id` with
  an `active_account_id`, never an `account_id`, so it is out of AC-3's frame entirely.
- `handle_new_user()` (`02_functions.sql:25-74`) bootstraps a `parent_admin` membership
  **only for the very first user** (`if not exists (select 1 from
  public.account_members)`). Every later signup gets no membership at all and fails
  closed — which is exactly why `add_persona()` is the only provisioning path that
  matters in practice. No existing row anywhere holds `role = 'shadchan'`, so AC-5's
  constraint cannot break any existing data on migration.
- `public.members`'s read policy is the single line `create policy "Enable read access
  for authenticated users" on public.members for select to authenticated using (true);`
  (`05_policies.sql:12`). `05_policies.sql` holds 22 policies in total; 17 of them call
  the resolver (2.1's list), and `members` is one of the 5 that do not.
- `supabase/tests/` today holds `billing_entitlement`, `members_rename`,
  `references_entity` and `shidduch_catch` (each `.sql` + `.test.ts`, plus the shared
  `dbSuiteHelpers.ts`). `context_resolution.sql`/`.test.ts` do not exist yet — 2.1
  creates them and this story extends them.

### Testing standards

Extend `supabase/tests/context_resolution.sql` + `.test.ts` (2.1) — same `results`/`ids`
temp-table shape as `references_entity.sql`, one row per assertion, `on commit drop`,
the `.test.ts` shelling out to `psql` and turning each row into a named `it()` via
`dbSuiteHelpers.bailIfDbUnreachable`. One file per RLS-adjacent feature area rather than
one file per story. Run via `npm run test:unit:db` with the local stack up; CI runs the
same project against a dedicated stack (`check.yml`: `make start-supabase-e2e` then
`CI=1 SUPABASE_DB_URL=… npm run test:unit:db`), where `CI=1` turns the local-dev skip
into a hard failure. `.claude/rules/security-triggers.md` makes the AC-3, AC-3a, AC-5 and
AC-9/10 tests mandatory, not optional polish.

### Project Structure Notes

Schema-only (`supabase/schemas/*.sql`, `supabase/migrations/*.sql`,
`supabase/tests/context_resolution.sql` + `.test.ts`). Task 5 calls for a `src/`
**audit** (find every `members` read and confirm it still resolves), but this story
edits no `src/` file — any consumer found broken by AC-9, and the
`getCurrentAccountId()` finding in particular, is a finding to report, not a fix to make
silently inside this ticket. Route/resource registration lives in
`root/routeManifest.ts` since Story 1.5; nothing in this story registers a surface, so
that file is read-only context for the audit.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-2] — `kind ∈ household | shadchanus`, the five-role
  vocabulary, "a **shadchanus context may never contain household domain rows**,
  enforced by CI and by scope checks (AD-1)", "`shadchan` is active, not deny-only — its
  access is granted solely through a connection (AD-20), never through household
  membership", "Personas are **mutable for life** … removing one **archives, never
  deletes**" (archiving itself is 2.5's).
- [Source: ARCHITECTURE-SPINE.md#AD-1] — "every domain row is scoped by **exactly one**
  … a non-null `account_id` … **or** a non-null `connection_id`. Never both, never
  neither," the basis for AC-3's table list.
- [Source: ARCHITECTURE-SPINE.md#AD-19] — the active context is a server-side row; why
  both new functions must reason about non-active contexts.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md] — the
  provisioning table, the six canonical family shapes, the "why they are separate"
  household/shadchanus reasoning (AC-5), the two out-of-scope bullets cited above, and
  the five roles (line 84).
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.2] — this story's own epic
  AC text ("personas are recorded per member, and contexts are typed Household or
  Shadchanus … a shadchanus context can never hold household records, enforced at the
  database … RLS prevents any cross-context read").
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md#What-this-story-deliberately-does-not-touch]
  — hands off the `members` read-policy tightening to this story by name; AC-9
  discharges that hand-off. Its "⚠️ Do not miss the storage policies" callout is why
  this story verifies `07_storage.sql` rather than assuming it.
- [Source: supabase/schemas/02_functions.sql:818-836] —
  `purge_polymorphic_dependents()`, the precedent this story's
  `enforce_household_scope()` follows for "one trigger function, many tables."
- [Source: supabase/schemas/04_triggers.sql] — the 13 `set_account_id_default`
  attachments that define AC-3's table set and create AC-3a's ordering hazard.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-code, bmad-dev-story workflow)

### Debug Log References

- Pre-flight gate confirmed: `grep -c current_account_id supabase/schemas/07_storage.sql`
  returned `0` before starting — 2.1's storage hand-off held.
- First `db diff -f persona_context_data_model` generation omitted the
  `revoke`/`grant execute` statements for all 5 new functions
  (`add_persona`, `enforce_household_scope`,
  `enforce_membership_role_matches_context`, `is_owning_membership_role`,
  `my_personas`) — the exact `db diff` gap the story and AGENTS.md warn
  about. All 5 hand-added to the generated migration, interleaved right
  after each function definition. No `DROP FUNCTION`/`CASCADE` appeared
  anywhere in the generated diff (nothing pre-existing is dropped by this
  story). `migration up --local` applied cleanly on the first attempt after
  the hand-edit.
- `db diff` also silently dropped both `comment on table` statements
  (AC-4's `subscription`/`ai_usage` carve-out documentation) — a second
  instance of the same "db diff misses metadata around objects it doesn't
  fully own" class of gap already known for `security_invoker`/GRANT lines.
  Caught by a dedicated test (`obj_description(...) is not null`) rather
  than by inspection; hand-added both `comment on table` statements to the
  migration and applied them directly to the already-migrated local DB.
  Re-ran `db diff -f phantom_check` twice after all hand-edits: **"No schema
  changes found"** both times — the migration file and the declarative
  schema agree exactly.
- Proof queries match the story's stated expectations exactly:
  `select count(*) from pg_trigger where tgfoid =
  'public.enforce_household_scope'::regproc and not tgisinternal` → `13`;
  `select count(*) from public.accounts where kind <> 'household'` → `0`;
  `validate_singles_household_scope`/`validate_tasks_household_scope` sort
  strictly after every `set_*`/`sync_*` BEFORE trigger on their tables
  (`order by tgname`); `account_members` carries no other BEFORE trigger
  besides the new `enforce_membership_role_matches_context_trigger`
  (`activate_first_context_trigger` remains AFTER INSERT only, confirmed via
  `pg_trigger.tgtype`).
- **Story claim did not reproduce**: Task 5's `getCurrentAccountId()`
  finding (`providers/supabase/dataProvider.ts:607-618`, "still does
  `.from("accounts").select("id").limit(1).maybeSingle()`") is **already
  fixed** on `main` — Story 2.1's "address review findings" commit
  (`cd253d5`) proactively changed it to `getSupabaseClient().rpc("current_context_id")`,
  ahead of the hand-off this story (and the build plan) expected to land in
  2.4. Verified via `git log -p -S'rpc("current_context_id")'`. Nothing left
  to report to 2.4 on this specific point; flagging here so nobody
  "re-fixes" an already-fixed line.
- `src/` audit (AC-9/AC-9a): `grep -rn '"members"' src/` returns the
  claimed 16 hits; `grep -rn 'from("members")' src/` returns 1
  (`authProvider.ts:71`). Walked AC-9a's table against the current tree —
  all 4 Supabase-backed reads (own-row `authProvider`/`ProfileSection`,
  context-scoped list `MemberList`/`MemberEdit`/`MemberCreate` via the
  manifest-registered `members` resource) survive the tightened policy
  unchanged; no consumer needed a fix.
- `context_resolution.sql` extended in place (2.1's suite) rather than a
  third RLS file, per Task 7. Ran the full extended suite directly via
  `psql` (mirroring `context_resolution.test.ts`'s wrapping) before wiring
  it into `npm run test:unit:db`: 82 checks, 0 failures. One iteration
  needed: the AC-3a positive test's `identity_signals` row could not be
  inserted directly as `authenticated` (`permission denied for table
  identity_signals` — that table is deliberately SELECT-only for clients,
  written only by the `SECURITY DEFINER` sync triggers per 06_grants.sql);
  switched that one assertion to read the row `sync_reference_identity_signals()`
  auto-creates for the `references` insert already in the fixture, rather
  than writing to `identity_signals` directly.

### Completion Notes List

- All 12 ACs implemented and verified against the local Supabase stack.
  `accounts.kind` (default `'household'`, checked) and the widened
  `account_members_role_check` (adds `single`) landed in `01_tables.sql`
  (AC-1, AC-2). `enforce_household_scope()` and
  `enforce_membership_role_matches_context()` added to `02_functions.sql`,
  attached as 13 `validate_<table>_household_scope` triggers (named to sort
  after every `set_*`/`sync_*` BEFORE trigger, per AC-3a) plus
  `enforce_membership_role_matches_context_trigger` on `account_members`
  (AC-3, AC-3a, AC-5); `subscription`/`ai_usage` carry a `comment on table`
  recording their deliberate exclusion (AC-4). `add_persona(p_persona
  text)` and `my_personas()` added, both `SECURITY DEFINER` /
  `SET search_path TO ''`, sharing a new `is_owning_membership_role(text)`
  IMMUTABLE helper so the "owning role" and "single persona" predicates can
  never diverge between provisioning and reporting (AC-6, AC-7, AC-8,
  AC-11). `public.members`'s read policy replaced: own row always readable,
  plus a co-member's row only within the caller's currently active account
  — narrower than "everyone", matching `account_members`'s own established
  third-party-visibility shape rather than extending visibility across
  every context the caller belongs to (a deliberate, documented reading of
  AC-9's "any of the caller's own active contexts" — see the policy's
  comment in `05_policies.sql`) (AC-9, AC-10).
- `add_persona()`'s single-detection predicate (`role = 'single' OR
  is_owning_membership_role(role)`) is used identically in both the
  no-op check (AC-6) and `my_personas()`'s `single` derivation (AC-8), per
  the story's "must not diverge" requirement — a change to one call site
  without the other would be a bug, not a style choice.
- `05_policies.sql`'s `members` policy reads `account_members` from inside
  its own `using` clause (`am.account_id = current_context_id() and
  am.status = 'active' and am.user_id = members.user_id`) — safe from
  recursion because `account_members`'s own policies never read `members`
  back (same precondition 2.1 already established for `accounts` reading
  `account_members`).
- Task 5's `src/` audit: no consumer of `public.members` needed a fix.
  `getCurrentAccountId()` — the one non-`members` finding Task 5 asks to
  report rather than fix — turned out to be **already fixed** by Story
  2.1's review-response commit; see Debug Log for the git evidence. Nothing
  further to hand off to 2.4 on that point.
- Migration `20260727233610_persona_context_data_model.sql` generated via
  `db diff`, hand-corrected for the two known gap classes (function
  GRANT/REVOKE lines; `comment on table` statements), applied via
  `migration up --local`, and verified byte-for-byte in sync with the
  declarative schema via a follow-up `db diff` reporting "No schema changes
  found".
- `supabase/tests/context_resolution.sql` / `.test.ts` (2.1's suite)
  extended with Story 2.2's checks: the 13-table `enforce_household_scope`
  negative test (AC-3), the 13-table no-`account_id` positive/ordering
  proof (AC-3a), `accounts.kind`/role-check structural assertions (AC-1,
  AC-2), both directions of the `enforce_membership_role_matches_context`
  negative test on INSERT plus one on UPDATE (AC-5), the two
  non-owning-membership negative cases for `add_persona('parent')`/`add_persona('single')`
  (AC-6), both orders of "single + parent yields one household" plus
  idempotency re-calls (AC-7), `my_personas()` shape/signature checks
  covering all three roles that can carry the `single` persona (AC-8), and
  the `members` visibility own-row/co-member/cross-household-negative set
  (AC-9, AC-10). 82 checks total in the file, 0 failures; threshold in
  `context_resolution.test.ts` raised from 35 to 75.
- Toolchain (AC-12), all green: `npm run typecheck`, `npm run lint`,
  `npm run prettier`, `npm run test` (617 tests, 55 files), `npm run
  test:unit:db` (226 tests, 5 files — includes the extended suite),
  `node scripts/check-retired-names.mjs`, `node scripts/check-suppressions.mjs`.
  No `src/` file was touched by this story (schema + tests only), so
  `npm run typecheck`/`lint` passing is expected rather than newly proven.
- Negative-test coverage for every RLS/permission change in this story
  (per `.claude/rules/security-triggers.md` and the repo's "Done means"
  bar): AC-3's 13-table rejection, AC-5's both-direction rejection (insert
  and update), AC-6's two non-owning-membership guards, and AC-9/10's
  cross-household `members` read all have a dedicated negative assertion
  proving the wrong context/role sees or does nothing.

### Review Response (adversarial review of commit `2a9ef04`, verdict NEEDS-FIX)

All 5 should-fix findings addressed; all 5 notes resolved by documentation or
correction (no note required a code change beyond finding #10's comment fix).
Nothing rejected — every finding reproduced live against the local stack
before being fixed.

- **Finding #1 (should-fix, blocker-grade) — single-role self-promotion to
  `parent_admin` via raw UPDATE. FIXED.** `06_grants.sql`: `authenticated`'s
  grant on `public.account_members` narrowed from `select, insert, update,
  delete` to `select, insert, delete` — UPDATE is withheld entirely, not
  narrowed to specific columns, because no legitimate client write path
  needs it (every role change today is `add_persona()`'s SECURITY DEFINER
  `UPDATE`, which runs as the function owner and is unaffected by grants on
  `authenticated`). `05_policies.sql`: the now-unreachable "Account members
  updatable within active account" policy removed outright rather than left
  as dead permissive text that could silently reopen the hole if the grant
  were ever restored without re-reading this comment; the policy count in
  `05_policies.sql` is 25 (was 26), confirmed against live `pg_policies`
  (`public`: 25, `storage`: 3, unchanged). Also confirmed no equivalent
  INSERT-side hole exists: `account_members_account_user_active_uq`
  (`(account_id, user_id) where status = 'active'`, `01_tables.sql`) rejects
  a second active row for the same pair, so an INSERT-based self-promotion
  attempt fails on the unique index. Verified live: `update
  public.account_members set role='parent_admin' where user_id=auth.uid()`
  as a `single`-role caller now raises `permission denied for table
  account_members`. Regression test added to `context_resolution.sql`
  (raw-UPDATE rejection + "no UPDATE policy exists at all" structural
  check).
- **Finding #2 (should-fix) — `add_persona()` did not fail closed on a NULL
  `auth.uid()`. FIXED.** `02_functions.sql`: `add_persona()` now raises
  `add_persona requires an authenticated caller` at the top of the function
  body when `auth.uid()` is NULL, before touching any table. Verified live:
  `set role service_role; select public.add_persona('parent');` (no JWT)
  now raises instead of silently creating an orphan
  `accounts`/`account_members` row with `user_id = NULL`. Regression test
  added (`service_role` with no `sub` claim; asserts both the raise and that
  no `user_id IS NULL` row was ever created).
- **Finding #3 (should-fix) — AC-3's 13-table negative test was vacuous for
  9 of 13 tables. FIXED, with one additional correction the finding's own
  fix didn't anticipate.** Tightened the assertion to `v_raised and v_detail
  like '%is not a household-kind account%'` per the finding's suggested fix.
  Running this against the live schema showed 12 of 13 tables already
  produce that exact message (BEFORE ROW triggers fire before NOT
  NULL/CHECK constraints are ever evaluated, so `enforce_household_scope()`
  — sorting after `set_*` but there being no other trigger to compete with
  on those 12 tables — was already the thing raising, contrary to the
  finding's implication that a same-looking-vacuous test would need a
  different fix for each masked table). **`tasks` was the one genuine
  case**: `sync_task_target_trigger` (BEFORE INSERT, `'s' < 'v'`) raises `a
  task needs a target` on the same minimal `(account_id)`-only insert this
  test used, before `validate_tasks_household_scope` is ever reached — a
  real masking bug in the test, not merely a theoretical mutation-testing
  gap. Fixed by supplying a placeholder `target_id` (not null, no FK — the
  column is polymorphic) for the `tasks` case only, so the insert clears
  `sync_task_target_trigger` and reaches `validate_tasks_household_scope`.
  All 13 tables now assert the correct message; suite green (233/233).
- **Finding #4 (should-fix) — dead `'My Account'` fallback, ships
  "Pending's Family". FIXED.** `02_functions.sql`, both `add_persona()`
  branches that create a household:
  `coalesce(v_first_name || '''s Family', 'My Account')` →
  `coalesce(nullif(v_first_name, 'Pending') || '''s Family', 'My Account')`.
  Verified live: a caller whose `members.first_name` is still the unset
  `'Pending'` default now gets `'My Account'`, not `"Pending's Family"`. The
  existing test asserting the old (wrong) name flipped to assert `'My
  Account'`; a new positive test added (a caller with a real
  `given_name` in `raw_user_meta_data`, MyShadchan's normal
  `handle_new_user()` derivation path) proves the `nullif()` guard only ever
  swallows the literal placeholder, never a genuine name — the household is
  named `"Devora's Family"` for that caller.
- **Finding #5 (should-fix) — no negative test for the 5 new functions'
  permission posture. FIXED.** Added the same `bool_and(not
  has_function_privilege('anon', p.oid, 'execute'))` shape Story 2.1 already
  used, scoped to `add_persona`, `my_personas`, `enforce_household_scope`,
  `enforce_membership_role_matches_context`, `is_owning_membership_role` —
  the exact regression class this story's own Debug Log recorded `db diff`
  silently causing once (dropping all 5 functions' REVOKE/GRANT lines from
  the generated migration).
- **Finding #6 (note) — AC-11's own grep count doesn't hold.** Confirmed:
  `grep -rn "insert into public.accounts" supabase/schemas/` returns **4**
  (`02_functions.sql`: `handle_new_user()` once, `add_persona()`'s three
  branches once each), not "exactly twice." AC-11's "twice" refers to the
  two *functions* that create an account (`handle_new_user`, `add_persona`),
  not to `grep` hit count — `add_persona()` legitimately has 3 separate
  `insert into public.accounts` statements (one per persona branch) as a
  single function. No code change owed; recorded here so the AC's own
  decided-by text is not repeated uncritically in a future story.
- **Finding #7 (note) — check-count inaccuracy in the report/commit
  message.** The prior commit message claimed "47 new checks (82 total)."
  82 total was accurate (verified independently by this review response);
  the delta claim was not — re-running `HEAD~1`'s `context_resolution.sql`
  emits 42 runtime checks, so the actual Story 2.2 delta was 40, not 47.
  This review response's own delta is stated precisely above (82 → 89, +7)
  rather than repeating an unverified figure. No source fix possible for
  the prior commit message (history is not rewritten); recorded here for
  the next reader.
- **Finding #8 (note) — provisioned rows are unnamed; hand-off to 2.3.**
  Confirmed unchanged by this review response (out of this story's scope
  per Task 3's own text, which only mandated the *household* name default):
  `add_persona('shadchan')` inserts `(kind)` only, so the shadchanus context
  renders as `'My Account'` in 2.4's switcher; `add_persona('single')`'s own
  `singles` row has `first_name_en = NULL`. Flagged for 2.3/2.4's UI to
  handle (e.g. a client-side "Unnamed shadchanus"/prompt-to-name fallback),
  not fixed here.
- **Finding #9 (note) — AC-9's narrower reading. No action; correctly
  disclosed already** in the original Completion Notes (a user active in
  their shadchanus context cannot read household co-members' `members` rows
  — fail-closed, consistent with `account_members`'s own shape).
- **Finding #10 (note) — `05_policies.sql`'s `interactions` comment carried
  a false premise. FIXED (comment only).** The comment claimed "today every
  authenticated member of an account is a parent/helper" and "when the
  `single` role lands (Epic 6)" — but AC-2 of *this* commit already added
  `single` to `account_members_role_check`. Corrected to state: the role
  exists as of Story 2.2, nothing yet assigns it to a real membership
  (Story 2.7/2.8's invite flow), the visibility restriction itself is still
  Epic 6's job, and the window is real-but-currently-theoretical (no code
  path creates a `single`-role membership today) rather than settled.

Toolchain re-run after all fixes, all green: `npm run typecheck`, `npm run
lint`, `npm run prettier`, `npm run test` (624 tests, 55 files — was 617),
`npm run test:unit:db` (233 tests, 5 files — was 226),
`node scripts/check-retired-names.mjs`, `node scripts/check-suppressions.mjs`.
`npx supabase db diff --local` after applying the fix migration: "No schema
changes found."

### File List

- `supabase/schemas/01_tables.sql` — added `accounts.kind` (default
  `'household'`, check `in ('household','shadchanus')`, AC-1); widened
  `account_members_role_check` to include `single` (AC-2); added
  `comment on table` on `public.subscription` and `public.ai_usage`
  recording their deliberate exclusion from `enforce_household_scope()`
  (AC-4).
- `supabase/schemas/02_functions.sql` — added `enforce_household_scope()`
  (AC-3), `enforce_membership_role_matches_context()` (AC-5),
  `is_owning_membership_role(text)` (shared helper, AC-6/AC-8),
  `add_persona(text)` (AC-6, AC-7, AC-11), `my_personas()` (AC-8).
- `supabase/schemas/04_triggers.sql` — added 13
  `validate_<table>_household_scope` triggers (`before insert or update of
  account_id`, one per AC-3's table list) and
  `enforce_membership_role_matches_context_trigger` (`before insert or
  update` on `account_members`).
- `supabase/schemas/05_policies.sql` — replaced `public.members`'s
  `Enable read access for authenticated users` (`using (true)`) with
  `Members readable by self or within active account` (AC-9).
- `supabase/schemas/06_grants.sql` — added `revoke`/`grant execute` blocks
  for the 5 new functions (`enforce_household_scope`,
  `enforce_membership_role_matches_context`, `is_owning_membership_role`,
  `add_persona`, `my_personas`), each revoked from `public`/`anon` and
  granted to `authenticated` + `service_role`.
- `supabase/migrations/20260727233610_persona_context_data_model.sql`
  (new) — generated via `db diff`, hand-corrected for the GRANT/REVOKE and
  `comment on table` gaps `db diff` leaves out; applied locally.
- `supabase/tests/context_resolution.sql` — extended (2.1's suite) with
  Story 2.2's checks (13-table negative + positive trigger-ordering proof,
  role/context-mismatch negative both directions, `add_persona()`
  idempotency and non-owning-membership negatives, `my_personas()` shape,
  `members` visibility positive/negative); header comment updated to
  describe both stories' coverage.
- `supabase/tests/context_resolution.test.ts` — header comment updated;
  minimum-checks threshold raised from 35 to 75.

**Review response (findings #1–#5, #10 above):**

- `supabase/schemas/02_functions.sql` — `add_persona()`: added the NULL
  `auth.uid()` fail-closed guard (finding #2); fixed the dead `'My Account'`
  fallback in both household-creation branches with `nullif(v_first_name,
  'Pending')` (finding #4).
- `supabase/schemas/05_policies.sql` — removed the "Account members
  updatable within active account" policy entirely (finding #1); rewrote
  the `account_members` command-scoping doc comment to record the closed
  gap; corrected the stale "Epic 6" premise in the `interactions` policy
  comment (finding #10).
- `supabase/schemas/06_grants.sql` — narrowed `authenticated`'s grant on
  `public.account_members` from `select, insert, update, delete` to
  `select, insert, delete` (finding #1).
- `supabase/migrations/20260728000529_story_2_2_review_fixes.sql` (new) —
  generated via `db diff` (clean this time — no GRANT/REVOKE or
  comment-metadata gap, since `add_persona()` is a plain `CREATE OR
  REPLACE` and the policy drop is a normal object removal), applied
  locally; hand-verified, then a follow-up `db diff` reported "No schema
  changes found".
- `supabase/tests/context_resolution.sql` — added: the NULL-caller
  `add_persona()` rejection test (finding #2), the anon-cannot-execute
  check for all 5 Story 2.2 functions (finding #5), the raw-UPDATE
  self-promotion rejection test plus a "no UPDATE policy exists" structural
  check (finding #1), a positive household-naming test for a caller with a
  real name (finding #4). Flipped the existing household-naming test's
  expected value from `"Pending's Family"` to `'My Account'` (finding #4).
  Tightened the AC-3 13-table negative test to assert the exact
  `enforce_household_scope()` error message, and special-cased `tasks`'
  insert to supply a placeholder `target_id` so it clears
  `sync_task_target_trigger` and actually reaches the trigger under test
  (finding #3).
- `supabase/tests/context_resolution.test.ts` — minimum-checks threshold
  raised from 75 to 85 (actual count is now 89, up from 82).
