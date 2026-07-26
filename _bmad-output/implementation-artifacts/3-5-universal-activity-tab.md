# Story 3.5: Universal Activity tab

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a consistent history on every record,
so that I can see what happened without hunting.

## Position in Epic 3

**Depends on 3.3** (its `EntityTabDescriptor` shape) and **3.9** (`RecordLink`, for the
"entries link to related records" requirement). **Suggested delivery order across the
epic, since dependencies do not follow the story numbers:** `3.1 → 3.2 → 3.3 → 3.9 → 3.4
→ 3.5 → 3.6 → 3.7 → 3.8`. Build 3.9 before this story even though it is numbered last —
epics.md's own AC text for this story ("entries link to related records via
`RecordLink`") makes the dependency real, not optional, and Epic 1 set the precedent for
an epic's delivery order departing from its story numbers when dependencies demand it
(1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6).

**3.6 depends on this story** (they share the same widened `interactions` table and
migration) and adds one filter this story's query must later respect: 3.6 adds a
`deleted_at` column for note soft-delete, and updates `ActivityTab`'s query (built here)
to add `deleted_at is null` so a soft-deleted note stops appearing in the Activity feed
too. **This story's `ActivityTab` query is edited again by 3.6 — that is expected, not a
regression.**

**Scope boundary — read before starting.** This story delivers a **standalone,
tested** `ActivityTab` component plus the backend widening that makes it correct for
all four AD-24 base entities. It does **not** mount the component into
`ShidduchShow.tsx`, `ReferenceShow.tsx`, `ShadchanShow.tsx` or `singles/SingleShow.tsx`
— wiring a tab into a live entity's tab bar is Epic 5's job (5.1, 5.8, 5.9, 5.10), same
posture as 3.1-3.4. `ShidduchTimeline.tsx`'s current inline read of `interactions`
survives unchanged until Epic 5 replaces it with this tab.

## Acceptance Criteria

1. **`interactions` accepts all four base entity types.** In
   `supabase/schemas/01_tables.sql`, `interactions_target_type_check` becomes
   `target_type in ('reference', 'shidduch', 'shadchan', 'single')` (was `('reference',
   'shidduch')`). `interactions_scope_link_check` gains a fourth branch —
   `(scope = 'account' and target_type in ('shadchan', 'single') and reference_link_id is
   null)` — **this is required, not optional**: without it, the three existing branches
   are exhaustive over the *old* two target types, so an insert with
   `target_type = 'shadchan'` or `'single'` fails the check regardless of the
   `target_type_check` widening. Verify by inserting a `shadchan`-targeted interaction
   locally after the migration and confirming it succeeds.

2. **RLS covers the two new target types — by refining the `scope = 'account'` branch,
   not by adding `or` branches.** The existing policy `"Interactions scoped to account
   and parent visibility"` (`supabase/schemas/05_policies.sql`) is
   `account-check AND (scope = 'account' OR shidduch-derived OR reference-derived)`.
   Because AC 1's constraint forces every `shadchan`/`single`-targeted row to
   `scope = 'account'`, appending new `or` branches would be **dead code** — the
   `scope = 'account'` disjunct already matches those rows unconditionally. Instead, the
   `scope = 'account'` disjunct itself becomes target-aware, in both `using` and
   `with check`:
   ```sql
   scope = 'account' and (
       target_type = 'reference'  -- today's behaviour, unchanged
       or (target_type = 'shadchan' and exists (
           select 1 from public.shadchanim sh
           where sh.id = interactions.target_id
             and sh.account_id = public.current_context_id()))
       or (target_type = 'single' and exists (
           select 1 from public.singles si
           where si.id = interactions.target_id
             and si.account_id = public.current_context_id()))
   )
   ```
   This gives the two new target types the target-scope integrity AD-1 demands (a row
   cannot point at another account's shadchan/single). The pre-existing
   `reference`-targeted account-scope branch carries no such exists-check today; leave it
   as-is — tightening it is a separate change with its own blast radius, not smuggled in
   here. **Uses `current_context_id()` (AD-19), not `current_account_id()`** — this story
   assumes Epic 2 has landed; see Dev Notes "Epic 2 dependency" for what to do if it has
   not.

3. **`actor_member_id` is server-set, never client-supplied.** A new
   `current_member_id()` function (`STABLE`, `SECURITY DEFINER`, `search_path ''` —
   same shape as `current_context_id()`) resolves the caller's own
   `account_members.id` for the active context: `select id from public.account_members
   where user_id = auth.uid() and account_id = public.current_context_id() and status =
   'active' order by id limit 1` (the `order by id limit 1` keeps it deterministic —
   `account_members` has no unique `(account_id, user_id)` constraint today, and the two
   existing inline copies of this lookup in `02_functions.sql` order the same way). A
   new trigger (`set_interaction_actor_member_id`, `before insert on
   public.interactions`) calls it and writes the result into `NEW.actor_member_id`,
   overriding any client-supplied value. **`current_member_id()` is defined once, here,
   as a named, reusable function — not inlined into the trigger body** — because Story
   3.6 needs the identical resolution for its own RLS policy and for a client-visible
   "is this mine" signal (single-owner rule, ARCHITECTURE-SPINE.md's Consistency
   Conventions). The same rule means the **two inline copies that already exist** in
   `02_functions.sql` (`log_reference_call` and the reference-merge function both run
   `select am.id … order by am.id limit 1` themselves) are replaced by calls to the new
   function in the same migration — note the function adds `status = 'active'`, a
   deliberate tightening the inline copies lacked. Enforcement of "never
   client-supplied" is the **trigger**, not a grant: today's `INSERT` grant on
   `interactions` is table-wide (only `UPDATE` is column-scoped to `(body, metadata)` —
   `06_grants.sql`), and it stays table-wide; the trigger makes a client-sent
   `actor_member_id` irrelevant by overwriting it. The DB suite (Task 3) proves it: an
   authenticated insert supplying a spoofed `actor_member_id` lands with the caller's
   real member id.

4. **`ActivityTab` renders a read-only, paginated, newest-first feed for any of the four
   target types.** `entity360/tabs/ActivityTab.tsx` exports a component taking
   `{ targetType: "shidduch" | "single" | "shadchan" | "reference"; targetId: Identifier
   }`, fetching `interactions` filtered to that pair, sorted `created_at DESC`, paged at
   20 per page. Pagination controls reuse `@/components/admin/list-pagination.tsx`
   (`ListPagination` reads `useListPaginationContext`, so wrap the tab's `useGetList`
   page state in ra-core's `ListPaginationContextProvider` — decided here so no third
   pagination pattern appears). Each row shows a kind label (the `KIND_LABELS` map from
   `shidduchim/ShidduchTimeline.tsx:19-26` and the `formatTimelineDate` helper from
   `:12-17`, both moved into `entity360/tabs/interactionLabels.ts` so 3.6 reuses them
   too), the timestamp, and `body` when present.

5. **A referenced record renders via `RecordLink`, never a hand-built `Link`.** When an
   interaction's `metadata` carries `{ linkedResource: string; linkedId: Identifier }`,
   the row renders that mention through `RecordLink` (3.9) rather than plain text or an
   ad-hoc `<Link>`. Rows without that shape in `metadata` render plain text — this story
   does not retrofit the existing interaction-writers to populate `metadata`. (Those
   writers are the SQL functions in `02_functions.sql` — the reference link/merge RPCs
   insert the `merge`/`link_created`/`link_removed` rows, not the panels that call them
   — so adopting the convention is a future SQL change, made when Epic 5 migrates those
   surfaces onto `Entity360`.)

6. **FakeRest stays in sync (AD-10).** The FakeRest provider mirrors the interactions
   constraints in `assertValidInteraction`
   (`providers/fakerest/dataProvider.ts` — it currently rejects any `target_type`
   other than `'reference'`/`'shidduch'` and knows only the three old scope branches).
   It is widened in lockstep with AC 1 — same four target types, same fourth scope
   branch — otherwise demo mode rejects rows the real backend accepts and this story's
   own fakerest-backed component tests cannot cover the two new target types.

7. **Empty, loading and error states render.** Loading shows a skeleton (matching the
   existing `Skeleton`-based pattern in `shidduchim/ShidduchShowHeader.tsx` /
   `ShidduchShow.tsx`'s own skeletons); an empty result shows a plain inline message
   (matching `shidduchim/ShidduchTimeline.tsx:120-122`'s "Nothing logged … yet" pattern —
   the tab-level empty state does not need the full `misc/EmptyState.tsx` CTA treatment,
   which is for whole-page emptiness); a fetch error shows a message, not a blank tab.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: widen `interactions`** (AC: 1, 6)
  - [ ] Edit `01_tables.sql`'s `interactions_target_type_check` and
        `interactions_scope_link_check` exactly as specified in AC 1. Update the
        surrounding comment block (`01_tables.sql:505-518`) to describe all four target
        types, not just the original two.
  - [ ] Widen `assertValidInteraction` in `providers/fakerest/dataProvider.ts` to the
        same four target types and fourth scope branch (AC 6), and extend
        `dataProvider.interactions.test.ts` with one accept case per new target type
        plus a reject case for a `shadchan`/`single` row claiming `scope = 'shidduch'`.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        widen_interactions_targets` — a CHECK-constraint change is a normal
        `ALTER TABLE … DROP CONSTRAINT … / ADD CONSTRAINT …` pair; confirm the diff is
        exactly that and not a `DROP TABLE`/`CREATE TABLE` pair (it should not be, since
        no column or table is renamed — hand-check anyway per this repo's standing rule
        that generated migrations are never applied unread).

- [ ] **Task 2 — Schema: RLS + actor trigger** (AC: 2, 3)
  - [ ] Rework the `scope = 'account'` disjunct of `"Interactions scoped to account and
        parent visibility"` in `05_policies.sql` (`using` and `with check`) exactly as
        AC 2 specifies — target-aware, not appended `or` branches.
  - [ ] Add `current_member_id()` to `02_functions.sql` (beside `current_context_id()`,
        same `STABLE SECURITY DEFINER search_path ''` shape) and
        `set_interaction_actor_member_id()` (mirrors the shape of
        `set_account_id_default()`) plus its `before insert on public.interactions`
        trigger in `04_triggers.sql`. Grant `execute` on `current_member_id()` to
        `authenticated` in `06_grants.sql` — Story 3.6 calls it directly from RLS and (via
        a thin read) from the client.
  - [ ] Replace the two inline member-id lookups in `02_functions.sql`
        (`log_reference_call`, reference-merge) with `public.current_member_id()`
        (AC 3 — single-owner rule; the added `status = 'active'` filter is intended).
  - [ ] `db diff -f ...` (can combine with Task 1's migration or a second one — prefer
        one migration for this story unless the diff output is easier to hand-check
        split), hand-check, then `migration up --local`.

- [ ] **Task 3 — The negative RLS test** (AC: 2, 3)
  - [ ] Add to `supabase/tests/references_entity.sql` (or a new
        `supabase/tests/interactions_targets.sql` + `.test.ts` pair if the existing file
        would grow past its own reasonable size — follow the existing
        `references_entity.test.ts` harness shape, `isolatedScript()` wrapper, JSON-row
        result pattern): two accounts, a `shadchan` row and a `single` row in each;
        assert (a) account A's client reads/writes only its own `shadchan`/`single`-targeted
        interactions and gets zero rows for account B's; (b) an insert by A targeting
        **B's** shadchan/single id is rejected by the refined `with check` (AC 2's
        target-integrity half); (c) an insert supplying a spoofed `actor_member_id`
        lands with the caller's real member id (AC 3). This is the story's
        security-triggers-mandated negative test (`.claude/rules/security-triggers.md`).

- [ ] **Task 4 — `ActivityTab.tsx` + `interactionLabels.ts`** (AC: 4, 5, 7)
  - [ ] Move `KIND_LABELS` and `formatTimelineDate` out of
        `shidduchim/ShidduchTimeline.tsx` into `entity360/tabs/interactionLabels.ts`;
        `ShidduchTimeline.tsx` imports them from there (a mechanical import-path fix,
        not a behaviour change — `ShidduchTimeline` itself is not otherwise touched, per
        this story's scope boundary). Story 3.6 imports the same file — no second copy.
  - [ ] Build `ActivityTab.tsx` per AC 4, 5, 7.
  - [ ] `ActivityTab.test.tsx`: one `it` per target type using fakerest/mock data (loading
        skeleton, empty state, populated feed newest-first, pagination Prev/Next, and the
        `RecordLink`-vs-plain-text branch from AC 5).

## Dev Notes

### Epic 2 dependency — what to do if `current_context_id()` is not there yet

AD-19 names the function this story's RLS depends on:
*"`current_context_id()` is `STABLE`, `SECURITY DEFINER`, `search_path ''`... `current_account_id()` … is deleted, not wrapped."* [Source: ARCHITECTURE-SPINE.md#AD-19]
Epic 3 is written assuming Epic 2 has landed. If, at implementation time, Epic 2 has not
shipped this function under this exact name, this story has exactly **one** thing to
retarget: the two new RLS branches in Task 2 (plus AC 2's wording). Do not fall back to
`current_account_id()` "temporarily" — NFR-14 forbids a fallback path, and
`current_account_id()` is slated for deletion by Epic 2 regardless.

### Why the `scope_link_check` branch is not optional (the easy-to-miss part)

`interactions_scope_link_check` is written as an **exhaustive, total** predicate over
`(scope, target_type, reference_link_id)`. The schema's own comments say so twice: the
policy comment — *"There is no third state a row can fall into"*
[Source: supabase/schemas/05_policies.sql — the comment above "Interactions scoped to
account and parent visibility"] — and the table comment — *"Without this discriminator a
row with a null reference_link_id silently fell through BOTH branches, which is how a
free-text note would have leaked to a candidate"*
[Source: supabase/schemas/01_tables.sql:505-518]. (Both comments are the schema's record
of implementing AD-3's "any state left unclassified" prevention — the words are the
schema's, not the spine's.) Widening `target_type_check` alone would let a
`shadchan`/`single`-targeted row pass the target-type check and then fail the scope-link
check on every insert, because none of its three existing branches mention those two
target types. Get the fourth branch in before testing anything else in this story, or
every subsequent test will fail on the wrong constraint and look like an RLS bug.

### Reuse already confirmed

`shidduchim/ShidduchTimeline.tsx:19-26` (`KIND_LABELS`), `:12-17`
(`formatTimelineDate`), `:97-101` (the `useGetList<Interaction>` filter shape) are the
existing, working reference implementation for exactly this data — this story
generalises it, it does not invent a new read pattern.
`@/components/admin/list-pagination.tsx` + ra-core's `ListPaginationContextProvider`
are the pagination reuse decided in AC 4.
`supabase/tests/references_entity.test.ts` is the existing harness shape for the new
negative test (`isolatedScript()`, JSON-row results, `npm run test:unit:db`).

### Testing standard

AAA; `app` project for `ActivityTab.test.tsx`; `db` project
(`npm run test:unit:db`, needs `make start`) for the new SQL suite
[Source: .claude/rules/testing.md]. Every RLS-touching change needs the negative test —
`.claude/rules/security-triggers.md` — done in Task 3.

### Migration workflow

Edit `supabase/schemas/*.sql` → `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff
--local -f <name>` → hand-check → `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase
migration up --local`. Never `db reset --local`, never `db push`
[Source: AGENTS.md#Database-Management; memory/supabase-cli-dbus-hang.md].

### Project Structure Notes

- `entity360/tabs/` is new (this is the first Epic 3 story to add a file under it).
  `ActivityTab.tsx` and `interactionLabels.ts` are separate files — the label map is a
  small, reusable lookup that 3.6 also imports, so it does not belong inside the tab
  component itself.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.5]
- [Source: ARCHITECTURE-SPINE.md#AD-1] — one polymorphic table, FORCE RLS,
  `current_context_id()`-scoped
- [Source: ARCHITECTURE-SPINE.md#AD-3] — the exhaustive-scope-classification precedent
  this story's constraint widening must not violate
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_context_id()`
- [Source: supabase/schemas/01_tables.sql:499-545] — the current `interactions` table,
  its two check constraints and their comments
- [Source: supabase/schemas/05_policies.sql:163-241] — the current RLS policy this story
  extends
- [Source: supabase/schemas/06_grants.sql:341-351,528-533] — the existing
  `actor_member_id` column-grant withholding this story's trigger complements
- [Source: src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx] — the existing,
  working single-entity implementation this story generalises
- [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts —
  `assertValidInteraction`] — the FakeRest constraint mirror widened in lockstep (AD-10)
- [Source: supabase/tests/references_entity.sql, references_entity.test.ts] — the
  existing DB-suite harness shape
- [Source: .claude/rules/security-triggers.md, .claude/rules/testing.md,
  .claude/rules/coding-style.md, .claude/rules/english-only.md]
- [Source: 3-3-entity-descriptor-registry.md, 3-9-recordlink-primitive.md] — this epic's
  own prior stories this one depends on

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
