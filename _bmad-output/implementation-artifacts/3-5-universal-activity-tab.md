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

2. **RLS covers the two new target types.** In `supabase/schemas/05_policies.sql`, the
   policy `"Interactions scoped to account and parent visibility"` gains two more `or`
   branches (mirroring the existing `target_type = 'shidduch'` branch's shape): a
   `shadchan`-targeted row is visible/writable only when
   `exists (select 1 from public.shadchanim sh where sh.id = interactions.target_id and
   sh.account_id = public.current_context_id())`, and a `single`-targeted row the same
   against `public.singles`. Both `using` and `with check` gain the branches. **Uses
   `current_context_id()` (AD-19), not `current_account_id()`** — this story assumes
   Epic 2 has landed; see Dev Notes "Epic 2 dependency" for what to do if it has not.

3. **`actor_member_id` is server-set, never client-supplied.** A new
   `current_member_id()` function (`STABLE`, `SECURITY DEFINER`, `search_path ''` —
   same shape as `current_context_id()`) resolves the caller's own
   `account_members.id` for the active context: `select id from public.account_members
   where user_id = auth.uid() and account_id = public.current_context_id() and status =
   'active'`. A new trigger (`set_interaction_actor_member_id`, `before insert on
   public.interactions`) calls it and writes the result into `NEW.actor_member_id`,
   overriding any client-supplied value. **`current_member_id()` is defined once, here,
   as a named, reusable function — not inlined into the trigger body** — because Story
   3.6 needs the identical resolution for its own RLS policy and for a client-visible
   "is this mine" signal; a second inline copy would violate the single-owner rule
   (ARCHITECTURE-SPINE.md's "Single-owner rule" convention: normalization/visibility-style
   logic lives in one function, not per-caller). `actor_member_id` is
   removed from the authenticated `INSERT`/`UPDATE` column grant in
   `supabase/schemas/06_grants.sql` (it already withholds `UPDATE` on this column via the
   existing `grant update (body, metadata) on table public.interactions to
   authenticated`; this AC additionally confirms `INSERT` cannot set it — a client-sent
   `actor_member_id` on insert is silently overwritten by the trigger, not merely
   ignored by convention).

4. **`ActivityTab` renders a read-only, paginated, newest-first feed for any of the four
   target types.** `entity360/tabs/ActivityTab.tsx` exports a component taking
   `{ targetType: "shidduch" | "single" | "shadchan" | "reference"; targetId: Identifier
   }`, fetching `interactions` filtered to that pair, sorted `created_at DESC`, paged at
   20 per page with **Prev/Next** controls (reuse `@/components/admin/list-pagination.tsx`
   if it can be driven from a manually-built list context; otherwise a minimal Prev/Next
   pair — do not build a third pagination pattern when the app already ships one). Each
   row shows a kind label (reusing/generalising the `KIND_LABELS` map already written for
   `shidduchim/ShidduchTimeline.tsx:19-26`, moved into
   `entity360/tabs/interactionLabels.ts` so 3.6 can reuse it too), the timestamp
   (`date-fns` `format`, matching the existing `formatTimelineDate` helper's shape), and
   `body` when present.

5. **A referenced record renders via `RecordLink`, never a hand-built `Link`.** When an
   interaction's `metadata` carries `{ linkedResource: string; linkedId: Identifier }`,
   the row renders that mention through `RecordLink` (3.9) rather than plain text or an
   ad-hoc `<Link>`. Rows without that shape in `metadata` render plain text — this story
   does not retrofit every interaction-writer to populate `metadata` (that is each
   writer's own future change; `RepeatRecognitionPanel.tsx` / `ReferenceMergeButton.tsx`
   already write `merge`/`link_created`/`link_removed` kinds and can adopt the
   convention when they are migrated onto `Entity360`).

6. **Empty, loading and error states render.** Loading shows a skeleton (matching the
   existing `Skeleton`-based pattern in `shidduchim/ShidduchShowHeader.tsx` /
   `ShidduchShow.tsx`'s own skeletons); an empty result shows a plain inline message
   (matching `shidduchim/ShidduchTimeline.tsx:120-122`'s "Nothing logged … yet" pattern —
   the tab-level empty state does not need the full `misc/EmptyState.tsx` CTA treatment,
   which is for whole-page emptiness); a fetch error shows a message, not a blank tab.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: widen `interactions`** (AC: 1)
  - [ ] Edit `01_tables.sql`'s `interactions_target_type_check` and
        `interactions_scope_link_check` exactly as specified in AC 1. Update the
        surrounding comment block (`01_tables.sql:505-518`) to describe all four target
        types, not just the original two.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        widen_interactions_targets` — a CHECK-constraint change is a normal
        `ALTER TABLE … DROP CONSTRAINT … / ADD CONSTRAINT …` pair; confirm the diff is
        exactly that and not a `DROP TABLE`/`CREATE TABLE` pair (it should not be, since
        no column or table is renamed — hand-check anyway per this repo's standing rule
        that generated migrations are never applied unread).

- [ ] **Task 2 — Schema: RLS + actor trigger** (AC: 2, 3)
  - [ ] Add the two new `or` branches to `"Interactions scoped to account and parent
        visibility"` in `05_policies.sql` (`using` and `with check`).
  - [ ] Add `current_member_id()` to `02_functions.sql` (beside `current_context_id()`,
        same `STABLE SECURITY DEFINER search_path ''` shape) and
        `set_interaction_actor_member_id()` (mirrors the shape of
        `set_account_id_default()`) plus its `before insert on public.interactions`
        trigger in `04_triggers.sql`. Grant `execute` on `current_member_id()` to
        `authenticated` in `06_grants.sql` — Story 3.6 calls it directly from RLS and (via
        a thin read) from the client.
  - [ ] `db diff -f ...` (can combine with Task 1's migration or a second one — prefer
        one migration for this story unless the diff output is easier to hand-check
        split), hand-check, then `migration up --local`.

- [ ] **Task 3 — The negative RLS test** (AC: 2)
  - [ ] Add to `supabase/tests/references_entity.sql` (or a new
        `supabase/tests/interactions_targets.sql` + `.test.ts` pair if the existing file
        would grow past its own reasonable size — follow the existing
        `references_entity.test.ts` harness shape, `isolatedScript()` wrapper, JSON-row
        result pattern): two accounts, a `shadchan` row and a `single` row in each;
        assert account A's client reads/writes only its own `shadchan`/`single`-targeted
        interactions and gets zero rows for account B's — this is the story's
        security-triggers-mandated negative test (`.claude/rules/security-triggers.md`).

- [ ] **Task 4 — `ActivityTab.tsx` + `interactionLabels.ts`** (AC: 4, 5, 6)
  - [ ] Move `KIND_LABELS` out of `shidduchim/ShidduchTimeline.tsx` into
        `entity360/tabs/interactionLabels.ts`; `ShidduchTimeline.tsx` imports it from
        there (a mechanical import-path fix, not a behaviour change — `ShidduchTimeline`
        itself is not otherwise touched, per this story's scope boundary).
  - [ ] Build `ActivityTab.tsx` per AC 4, 5, 6.
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
`(scope, target_type, reference_link_id)` — read its own comment:
*"The database rejects a row that is neither [shidduch-scoped nor account-scoped] — there
is no third state a row can fall into."* [Source: supabase/schemas/01_tables.sql:508-518]
Widening `target_type_check` alone would let a `shadchan`/`single`-targeted row pass the
target-type check and then fail the scope-link check on every insert, because none of its
three existing branches mention those two target types. This is the same class of mistake
AD-3's design note explicitly warns against ("a free-text note took [the wrong branch]
and would have bypassed visibility entirely") — get the fourth branch in before testing
anything else in this story, or every subsequent test will fail on the wrong constraint
and look like an RLS bug.

### Reuse already confirmed

`shidduchim/ShidduchTimeline.tsx:19-26` (`KIND_LABELS`), `:12-17`
(`formatTimelineDate`), `:97-101` (the `useGetList<Interaction>` filter shape) are the
existing, working reference implementation for exactly this data — this story
generalises it, it does not invent a new read pattern.
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
