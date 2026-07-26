# Story 2.2: Persona and Context Data Model

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want personas and contexts modelled explicitly in the schema,
so that provisioning a persona and authorising against a context both read from one
source of truth instead of each screen inventing its own rule.

## Dependencies

**Requires Story 2.1 (hard).** Every RLS predicate this story writes calls
`current_context_id()`; the `account_members`/`accounts` "own rows always visible"
shapes this story relies on (to know which contexts a caller belongs to before
provisioning a new one) are 2.1 AC-7. Do not start this story until 2.1's migration is
applied.

**Feeds 2.3, 2.4, 2.5.** 2.3 (onboarding) and 2.5 (lifecycle changes) both call this
story's `add_persona()` — they do not reimplement provisioning. 2.4 (context switcher)
reads `accounts.kind` to label contexts "Household" vs "Shadchanus" and calls
`public.my_personas()` (this story) to decide whether to render a switcher at all.

## Acceptance Criteria

1. **A context has a kind, and it isn't a guess.** `public.accounts` gains `kind text
   not null default 'household' check (kind in ('household', 'shadchanus'))`. Every
   account created before this migration becomes `'household'` (correct: no
   shadchanus context exists yet in this codebase — Epic 8 is the first consumer of the
   type beyond this story's own provisioning function).

2. **`single` is a real role, matching AD-2 exactly.** `account_members_role_check` is
   `role in ('parent_admin', 'single', 'helper', 'self_manager', 'shadchan')` — today it
   is missing `single` entirely, which means the role the glossary calls "a single with
   their own login" (personas-and-contexts.md shape 5) cannot currently be assigned to
   anyone.

3. **A shadchanus context cannot hold a household domain row — enforced by Postgres,
   not by convention.** One shared trigger function,
   `public.enforce_household_scope()` (`before insert or update of account_id` — the
   update event too, so a row can never be *moved* onto a shadchanus account by any
   write path RLS does not stop, e.g. a service-role caller; one function reused across
   every table per the single-owner-logic convention — mirrors
   `purge_polymorphic_dependents()`'s existing pattern), raises unless
   `exists (select 1 from public.accounts where id = new.account_id and kind =
   'household')`. Attached to all 13 household-only domain tables: `singles`,
   `shadchanim`, `"references"`, `shidduchim`, `resumes`, `reference_links`,
   `date_records`, `redts`, `shidduch_schools`, `interactions`, `identity_signals`,
   `inbox_items`, `tasks`. A negative test inserts a row into each with a
   `shadchanus`-kind `account_id` and confirms every one of the 13 raises.

4. **`subscription` and `ai_usage` are deliberately excluded from AC-3's list.** Nothing
   in AD-16 or the SPEC restricts billing/entitlement to household contexts, and no
   story states a shadchan-billing rule one way or the other. Decision: leave both
   scoped generically by `current_context_id()` (any context kind may hold a
   subscription row) rather than guess a restriction nobody asked for. Flagged in Dev
   Notes as an open product question, not silently resolved.

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
   changes nothing the second time. Behaviour per persona, matching
   personas-and-contexts.md's provisioning table exactly:
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
     **any** of the caller's own active memberships, no-op — the same predicate
     `my_personas()` (AC-8) reports the `single` persona by, so provisioning and
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

7. **Ticking both `single` and `parent` yields one household, not two** (FR/shape from
   personas-and-contexts.md, "ticking both single and parent yields one household
   containing me and my children"). A test calls `add_persona('parent')` then
   `add_persona('single')` for the same caller and asserts exactly one household-kind
   `account_members` row exists for them (`role = 'parent_admin'`) plus exactly one
   `singles` row with `member_id` pointing at it — never a second household.

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
   rather than re-deriving the same predicate three ways.

9. **`members` profile visibility is scoped to "shares a context with me," not
   everyone.** `public.members`'s `Enable read access for authenticated users`
   policy (`using (true)` today) is replaced with: a caller always reads their own row,
   plus any other `members` row belonging to a user who shares an **active** membership
   in any of the caller's own active contexts. A negative test proves a user in
   household A cannot read the profile row of a user who belongs only to household B.

10. **RLS prevents any cross-context read** — the epic's own AC text for this story,
    verified concretely rather than left as a slogan: a member of household A querying
    `singles`, `shidduchim`, `references`, `tasks` and `members` while household B holds
    rows of each returns zero from B in every case (this reuses/extends 2.1's
    `context_resolution.sql` suite rather than duplicating its setup — see Task 7).

11. **No alias, shim or second provisioning path survives** (NFR-14). Specifically: no
    second SQL function that also creates a household or a `singles` row (2.3's
    onboarding UI and 2.5's settings UI both call `add_persona()`; neither performs its
    own `insert into public.accounts` or `insert into public.singles`), and no
    `kind` value beyond `household`/`shadchanus` is ever introduced.

12. **Toolchain green**, scoped to this story's changed files for formatting
    (`make typecheck && npm run lint && make test && npm run test:unit:db`;
    `npx prettier --check` over changed files only).

## Tasks / Subtasks

- [ ] **Task 1 — `accounts.kind` and the `single` role** (AC: 1, 2)
  - [ ] `supabase/schemas/01_tables.sql`: add the `kind` column to `accounts`
        (AC-1) and extend `account_members_role_check` to include `single` (AC-2).

- [ ] **Task 2 — Household-scope + role/context enforcement triggers** (AC: 3, 4, 5)
  - [ ] `supabase/schemas/02_functions.sql`: add `enforce_household_scope()` per AC-3
        and `enforce_membership_role_matches_context()` per AC-5.
  - [ ] `supabase/schemas/04_triggers.sql`: attach `enforce_household_scope_trigger`
        (`before insert or update of account_id`) to each of the 13 tables in AC-3. Do **not** attach it to
        `subscription`/`ai_usage` (AC-4) — add a one-line schema comment on both
        recording the decision and pointing at this story, so the omission reads as
        deliberate to the next developer, not missed. Attach
        `enforce_membership_role_matches_context_trigger` (`before insert or update`)
        to `account_members`.
  - [ ] `06_grants.sql`: for both new trigger functions, `revoke all on function …
        from public, anon;` then grant `execute` to `authenticated` and `service_role`
        — Postgres grants EXECUTE on a new function to PUBLIC by default, so "no anon
        grant" alone is not deny; the file's own revoke-then-grant pattern is. Neither
        is `SECURITY DEFINER` — each only reads `accounts.kind` for the row it is
        validating, which the inserting/updating member's own RLS already lets them
        read.

- [ ] **Task 3 — `add_persona()`** (AC: 6, 7, 11)
  - [ ] `supabase/schemas/02_functions.sql`: implement per AC-6's three branches, as
        `SECURITY DEFINER` / `SET search_path TO ''`. Query `account_members`/`singles`
        directly filtered to `user_id = auth.uid()` — never rely on `current_context_id()`
        or on RLS having already scoped a read, since the target context may not be
        active (AC-6's rationale). Do not query across other users' rows at all.
  - [ ] For the household-creation paths (both branches), default the new household's
        `accounts.name` from the caller's `public.members` row (e.g. `"<first_name>'s
        Family"`), falling back to the column's own `'My Account'` default if the
        profile has no name yet. (There is no naming precedent to copy:
        `FirstRunSetup.tsx`'s "account" step *renames* the bootstrapped account via a
        form — placeholder "The Klein Family" — it never generates a default. 2.3
        keeps that rename step for the `parent` path, so this default only has to be
        presentable, not final.)
  - [ ] `06_grants.sql`: `revoke all on function … from public, anon;` then grant
        `execute` to `authenticated` (the standard pattern — see Task 2's note).

- [ ] **Task 4 — `my_personas()`** (AC: 8)
  - [ ] Implement per AC-8 as `SECURITY DEFINER` / `SET search_path TO ''`, sharing the
        exact same "owning role" / "singles row via member_id" predicates Task 3 uses —
        if a future edit changes one, changing the other is not optional. Factor the
        shared "is this an owning role" test (`role in ('parent_admin', 'self_manager')`)
        into one small `IMMUTABLE` SQL function used by both, rather than repeating the
        literal list twice.
  - [ ] `06_grants.sql`: `revoke all on function … from public, anon;` then grant
        `execute` to `authenticated` (see Task 2's note). Because this
        function is `SECURITY DEFINER` and reads across all of `auth.uid()`'s rows
        regardless of RLS, double-check it takes **no** parameter that could target
        another user — the function signature itself is the only guard, so get the
        signature right (`my_personas()`, no arguments) rather than relying on a body
        check that a future edit could loosen.

- [ ] **Task 5 — Tighten `members`'s read policy** (AC: 9)
  - [ ] `05_policies.sql`: replace `Enable read access for authenticated users` on
        `public.members` with AC-9's predicate.
  - [ ] Confirm no existing consumer breaks: `grep -rn '"members"' src/` (post-1.2
        rename) for every `useGetList`/`getOne` call against the resource, and confirm
        each is inside a context where the caller shares that context with the member
        being read (the users list at `/members`, profile lookups on suggestion cards
        showing "owner", etc.). Flag, do not silently work around, any call site that
        assumed the old unscoped visibility.

- [ ] **Task 6 — Migration** (AC: 1, 2, 3, 5, 6, 8, 9)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        persona_context_data_model`, hand-check per the same cautions as 2.1's Task 6
        (grants/security_invoker dropped by `db diff`), then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.

- [ ] **Task 7 — Tests** (AC: 3, 5, 7, 10, 12)
  - [ ] Extend `supabase/tests/context_resolution.sql` (created by 2.1) rather than
        starting a third RLS test file for this domain — add: the 13-table
        `enforce_household_scope` negative test (AC-3), the role/context-mismatch
        negative test (AC-5), the `add_persona()` idempotency and single-household
        (AC-7) checks, the two non-owning-membership negative tests (a `helper`-only
        caller ticking `parent` gets a new household, never a promotion; an invited
        `single`-role member ticking `single` is a no-op, never a second household —
        AC-6), `my_personas()` output-shape checks (AC-8), and the `members`
        visibility negative test (AC-9/10).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        scoped prettier per AC-12.

## Dev Notes

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

"Ticking both single and parent yields one household containing me and my children" —
[Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#Personas-change-over-a-lifetime]

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

### Decisions this story settles — and the one it leaves open

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
- **Left open — whether a shadchanus context may hold a `subscription`/`ai_usage` row**
  (AC-4). No source resolves this either way; excluding both from
  `enforce_household_scope()` is the conservative (does-not-block) choice, reversible
  later without a data migration since no shadchanus-scoped subscription rows can exist
  yet (Epic 8 is the first thing that creates a shadchanus context in a real user's
  hands). Flagged for the product owner; nothing in Epic 2 blocks on it.

### Security posture

Two new `SECURITY DEFINER` functions, two new enforcement triggers, and one RLS-policy
tightening (`members`) make this a `.claude/rules/security-triggers.md` case — a
security review is expected. The specific things to hunt for: (1) confirm neither
`add_persona()` nor `my_personas()` ever takes or trusts a caller-supplied user/account
identifier — both must derive everything from `auth.uid()` alone, exactly as
`current_context_id()`/`set_active_context()` do; (2) confirm
`enforce_membership_role_matches_context()` fires on `update` as well as `insert` — a
role *change* on an existing row (e.g. a future story promoting someone) must be checked
too, not just the initial insert.

### Verified current state (checked against `main` @ `8ad49cb`, 2026-07-26)

- `accounts` has no `kind` column today (`01_tables.sql:237-257`).
- `account_members_role_check` is `role in ('parent_admin', 'helper', 'self_manager',
  'shadchan')` — **`single` is missing** (`01_tables.sql:271-273`), confirmed against
  AD-2's rule text (`parent_admin | single | helper | self_manager | shadchan`) and
  against personas-and-contexts.md's "Roles within a context" list, which independently
  states the same five.
- The 13 household-only tables in AC-3 are every table in the current schema with a
  non-null `account_id` FK to `public.accounts` **except** `accounts`, `account_members`,
  `member_state` (context/membership tables themselves), `pipeline_transitions` and
  `configuration` (non-tenant reference/global data — confirmed neither has an
  `account_id` column at all), and `subscription`/`ai_usage` (AC-4's explicit carve-out).
- Today, `account_members`'s only role in play is `parent_admin` (`handle_new_user()`'s
  bootstrap) — no existing row anywhere holds `role = 'shadchan'`, so AC-5's constraint
  cannot break any existing data on migration.

### Testing standards

Extend `supabase/tests/context_resolution.sql` (2.1) — same `results`/`ids` temp-table
shape, one file per RLS-adjacent feature area rather than one file per story, run via
`npm run test:unit:db`. `.claude/rules/security-triggers.md` makes the AC-3, AC-5 and
AC-9/10 negative tests mandatory, not optional polish.

### Project Structure Notes

Schema-only again (`supabase/schemas/*.sql`, `supabase/migrations/*.sql`,
`supabase/tests/context_resolution.sql`). Task 5 calls for a `src/` **audit** (find
every `members` resource read and confirm it still resolves), but this story edits no
`src/` file itself — any consumer found broken by AC-9 is a finding to report, not a fix
to make silently inside this ticket (if a genuine regression is found, flag it to the
epic owner rather than quietly expanding scope).

### References

- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary, "a shadchanus context may
  never contain household domain rows, enforced by CI and by scope checks," "`shadchan`
  … access is granted solely through a connection … never through household membership,"
  "personas are mutable for life … removing one archives, never deletes" (archiving
  itself is 2.5's).
- [Source: ARCHITECTURE-SPINE.md#AD-1] — "every domain row is scoped by exactly one …
  `account_id` … Never both, never neither," the basis for AC-3's table list.
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md] — the
  provisioning table, the six canonical family shapes, the "why they are separate"
  household/shadchanus reasoning (AC-5), the two out-of-scope bullets cited above.
- [Source: _bmad-output/implementation-artifacts/2-1-context-aware-authorisation.md#What-this-story-deliberately-does-not-touch]
  — hands off the `members` read-policy tightening to this story by name; AC-9
  discharges that hand-off.
- [Source: supabase/schemas/02_functions.sql:1199-1217] —
  `purge_polymorphic_dependents()`, the precedent this story's
  `enforce_household_scope()` follows for "one trigger function, many tables."

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
