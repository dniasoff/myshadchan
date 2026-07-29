---
baseline_commit: 3dd6394ccd309d55223b2e5ad87b1add834dad12
---

# Story 3.5: Universal Activity tab

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a consistent history on every record,
so that I can see what happened without hunting.

## Position in Epic 3

This story is **step 8** of the build order in
`_bmad-output/planning-artifacts/epic3-api-contract.md` §12. It is the **first universal
tab**, and every later tab reuses what it lands.

**Blocking dependencies — all must be merged before this story starts:**

| Dependency | What this story consumes from it |
|---|---|
| **3-14** — `3-14-context-scope-lift-tasks-interactions.md` (household-scope lift) | Drops `validate_interactions_household_scope` (`supabase/schemas/04_triggers.sql:195-197`). Without it, an `interactions` insert in a `shadchanus` context dies with a raw Postgres exception and half of AC 10 cannot pass. Contract §11 Ruling 1. |
| **3.9** — `3-9-recordlink-primitive.md` (`RecordLink` + target-type vocabulary) | `ENTITY_TARGET_TYPES` / `EntityTargetType` in `src/components/atomic-crm/types.ts` (contract §10), `entity360/RecordLink.tsx` (contract §7), and the `?raw` schema guard with its `PENDING_DB_WIDENINGS` constant (contract §8 rule 2). |
| **3.3a** — `3-3-entity-descriptor-registry.md` (descriptor + registry) | `getEntityDescriptor` — the guarded accessor `RecordLink` degrades through (contract §4 rule 3). |
| **3-10** — `3-10-tab-vocabulary.md` (`TabKey` union) | The `activity` key and its `TAB_LABELS` entry. This story does **not** register a tab on any descriptor; it ships the component the key will point at. |

**Stories that depend on this one:** 3.6 (Notes — `current_member_id()`,
`set_interaction_actor_member_id`, `interactionLabels.ts`, the widened `target_type`, the
`deleted_at` column), 3.7 (Files — the four-value target vocabulary and
`current_member_id()`), and the AD-24 conformance validator
(`3-11-ad24-conformance-validator.md`, which asserts `PENDING_DB_WIDENINGS` is empty).

> **Numbering note.** The contract (§10, §12) refers to the tab-vocabulary story as "3-13" and
> the conformance validator as "3-15". The files that actually exist are
> `3-10-tab-vocabulary.md` and `3-11-ad24-conformance-validator.md`; `3-13-records-at-urls-not-modals.md`
> is the UX-DR3 story. This story cites the **filenames**, which are authoritative over the
> contract's provisional numbers.

**Scope boundary — read before starting.** This story delivers a **standalone, tested**
`ActivityTab` component plus the backend widening that makes it correct for all four AD-24
base entities. It does **not** mount the component into `ShidduchShow.tsx`,
`ReferenceShow.tsx`, `ShadchanShow.tsx` or `singles/SingleShow.tsx`, and it registers no
`tabs` entry on any `EntityDescriptor` — that is Epic 5 (5.1, 5.8, 5.9, 5.10), the same
posture as 3.1–3.4. `shidduchim/ShidduchTimeline.tsx` and `references/ReferenceTimeline.tsx`
keep working as they are; this story only lifts their duplicated label/date helpers into the
shared module they will both import (AC 7), and Epic 5 replaces both surfaces later.

## Acceptance Criteria

1. **`interactions` accepts all four base entity types.** In `supabase/schemas/01_tables.sql`,
   `interactions_target_type_check` (`:458-460`) becomes
   `target_type in ('reference', 'shidduch', 'shadchan', 'single')` — the same four values as
   `ENTITY_TARGET_TYPES` (contract §8), in any order.
   `interactions_scope_link_check` (`:473-476`) gains a **fourth branch**:

   ```sql
   or (scope = 'account' and target_type in ('shadchan', 'single') and reference_link_id is null)
   ```

   **This is required, not optional.** The existing three branches are exhaustive over the
   *old* two target types, so a row with `target_type = 'shadchan'` or `'single'` fails
   `interactions_scope_link_check` on every insert regardless of the `target_type_check`
   widening. **Falsifiable:** with only the `target_type_check` widened and the fourth branch
   omitted, an insert of a `shadchan`-targeted row raises
   `new row ... violates check constraint "interactions_scope_link_check"`; with both changes
   it succeeds. Both halves are asserted in the `db` suite (AC 10).

   A `shadchan`- or `single`-targeted interaction is **always** `scope = 'account'` with
   `reference_link_id is null`: neither entity has one shidduch parent from which visibility
   could derive (a single belongs to many shidduchim; a shadchan to many more), so there is no
   shidduch whose `visibility` could ever gate the row. The AD-3 exhaustiveness the two schema
   comments describe (`01_tables.sql:465-472`, `05_policies.sql:242-247`) is preserved: every
   `(scope, target_type, reference_link_id)` triple is still either explicitly legal or
   rejected.

2. **The comment blocks that describe the constraint are rewritten in the same edit, and the
   retired word goes with them.** `01_tables.sql:438-451` (the `scope` discriminator comment)
   and `:465-472` (the `scope_link_check` comment) currently describe **two** target types.
   Both are rewritten to describe all four, including why `shadchan`/`single` can only ever be
   account-scoped. `:451`'s *"…would have leaked to a **candidate**"* uses a name AD-23 retires
   [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:175`]
   — it becomes **single** in the same edit. **Falsifiable:**
   `grep -n "candidate" supabase/schemas/01_tables.sql` returns no hit inside `:425-477`.

3. **RLS covers the two new target types by refining the `scope = 'account'` disjunct — not by
   appending `or` branches.** The policy `"Interactions scoped to account and parent
   visibility"` (`supabase/schemas/05_policies.sql:262-313`) is
   `account-check AND (scope = 'account' OR shidduch-derived OR reference-derived)`. Because
   AC 1 forces every `shadchan`/`single`-targeted row to `scope = 'account'`, a new top-level
   `or` branch would be **dead code** — the bare `scope = 'account'` disjunct already matches
   those rows unconditionally. The disjunct itself becomes target-aware, identically in
   `using` **and** `with check`:

   ```sql
   (
       scope = 'account'
       and (
           target_type = 'reference'   -- today's behaviour, unchanged
           or (target_type = 'shadchan' and exists (
               select 1 from public.shadchanim sh
               where sh.id = interactions.target_id
                 and sh.account_id = public.current_context_id()))
           or (target_type = 'single' and exists (
               select 1 from public.singles si
               where si.id = interactions.target_id
                 and si.account_id = public.current_context_id()))
       )
   )
   ```

   This gives the two new target types the target-scope integrity AD-1 requires — a row cannot
   point at another context's shadchan or single
   [Source: `.../ARCHITECTURE-SPINE.md:60`]. The enumeration is deliberately **closed**: an
   account-scoped row with any other `target_type` (including `shidduch`, which AC 1 keeps
   illegal in this bucket) is denied rather than falling through, so a future constraint
   loosening fails closed.

   The pre-existing `reference`-targeted account-scope branch carries no such `exists` check
   today; **leave it as-is** — tightening it is a separate change with its own blast radius and
   is not smuggled in here.

   The policy's own comment (`05_policies.sql:255-261`) says a future Epic 6 story turns the
   `scope = 'account'` disjunct into "an outright deny for the single role". That instruction
   still holds and now applies to a three-way disjunct rather than a bare predicate — **update
   that comment in the same edit** so Epic 6 is not told to edit something that no longer looks
   like what the comment describes.

4. **`actor_member_id` is server-set, never client-supplied.** A new `current_member_id()`
   function is added to `supabase/schemas/02_functions.sql`, in **exact `pg_dump` form**
   (`CREATE OR REPLACE FUNCTION "public"."current_member_id"() RETURNS bigint / LANGUAGE
   "plpgsql" STABLE SECURITY DEFINER / SET "search_path" TO ''`) — the same shape as
   `current_context_id()` at `:201-203`, because anything else produces a phantom diff
   [Source: AGENTS.md#Database-Management]. Body:

   ```sql
   select am.id into v_member_id
   from public.account_members am
   where am.user_id = auth.uid()
     and am.account_id = public.current_context_id()
     and am.status = 'active'
   order by am.id
   limit 1;
   ```

   `execute` is granted to `authenticated` and `service_role` and revoked from `public, anon`
   in `06_grants.sql`, following the `current_context_id()` block at `:224-227` exactly —
   Story 3.6 calls it from RLS and from a client-visible "is this mine" read.

   A trigger function `set_interaction_actor_member_id()` (plain `LANGUAGE "plpgsql"`, **not**
   `SECURITY DEFINER` — it mirrors `set_account_id_default()` at `:359-369`, and the definer
   privilege it needs lives inside `current_member_id()`) assigns
   `new.actor_member_id := public.current_member_id()` unconditionally, and is attached in
   `04_triggers.sql` as `set_interaction_actor_member_id before insert on public.interactions`.
   It **overwrites** any client-supplied value; it does not merely default it.

   Enforcement is the **trigger**, not a grant: the `INSERT` grant on `interactions` is
   table-wide (`06_grants.sql:421`; only `UPDATE` is column-scoped, `:615-616`) and stays
   table-wide. **Falsifiable:** an authenticated insert that explicitly supplies
   `actor_member_id = <some other member's id>` lands with the caller's own
   `current_member_id()` value (AC 10c).

   `current_member_id()` is defined **once, here, as a named reusable function** — not inlined
   into the trigger body — because 3.6 needs the identical resolution. By the same
   single-owner rule
   [Source: `.../ARCHITECTURE-SPINE.md:190`], the **two inline copies that already exist** are
   replaced by calls to it in the same migration: `log_reference_call` (`02_functions.sql:2128-2132`)
   and `merge_references` (`:2381-2385`). Both currently omit `and am.status = 'active'`; adding
   it is a **bug fix**, not merely a tightening — a login holding both an archived and an active
   membership in the same account has two `account_members` rows (the unique index at
   `01_tables.sql:710` is partial, `where status = 'active'`), and `order by am.id limit 1`
   picks the **archived, lower-id** one. `order by am.id limit 1` is nonetheless kept in
   `current_member_id()` as a defensive tiebreak, so the function can never start raising
   "more than one row" if that partial index is ever dropped.

5. **Deleting a single or a shadchan leaves no orphaned polymorphic rows.** `interactions.target_id`
   carries no FK by design, and `purge_polymorphic_dependents()` (`02_functions.sql:1799-1817`)
   is wired to only two parents today: `04_triggers.sql:109-111` (`references`) and `:118-120`
   (`shidduchim`). This story adds the two missing parents, following those two verbatim:

   ```sql
   create or replace trigger purge_single_dependents
       before delete on public.singles
       for each row execute function public.purge_polymorphic_dependents('single');

   create or replace trigger purge_shadchan_dependents
       before delete on public.shadchanim
       for each row execute function public.purge_polymorphic_dependents('shadchan');
   ```

   The function itself is **not modified** — its `TG_ARGV[0]` design is exactly why one
   function serves every polymorphic parent. **Falsifiable:** deleting a `singles` row leaves
   zero `interactions`, zero `tasks` and zero `identity_signals` rows with
   `(target_type, target_id)` pointing at it; likewise for `shadchanim` (AC 10d).
   `entity_files` joins this function in 3.7 (contract §10).

6. **`types.ts` and the soft-delete column land here, not in 3.6.** Per contract §10:
   - `src/components/atomic-crm/types.ts:477` — `target_type: "reference" | "shidduch"` becomes
     `target_type: EntityTargetType`, importing the union 3.9 defined. It is **not** re-spelled
     as a local four-value literal.
   - `Interaction` gains `deleted_at?: string | null`.
   - `supabase/schemas/01_tables.sql` — `interactions` gains
     `deleted_at timestamp with time zone` (nullable, no default). **This story owns the column
     and the read filter; 3.6 owns the soft-delete write path, its moderation policy and its
     UI, and must not re-add the column.**

   Without the `types.ts` edit `npm run typecheck` fails on this story's first fixture, which
   is why it cannot be deferred.

   **`PENDING_DB_WIDENINGS`** (the constant `3-9-recordlink-primitive.md` ships alongside the `?raw` schema guard,
   contract §8 rule 2) loses its `interactions_target_type_check` entry, and the guard passes.
   `tasks_target_type_check` and the not-yet-existing `entity_files` check stay listed — 3.8
   and 3.7 remove those. **Falsifiable:** reverting AC 1's constraint edit turns the guard red.

7. **`interactionLabels.ts` is the one home for interaction presentation, and it is
   translated.** A new `src/components/atomic-crm/entity360/tabs/interactionLabels.ts` exports:
   - `formatTimelineDate(iso: string): string` — moved **verbatim** from
     `shidduchim/ShidduchTimeline.tsx:12-17` (the only definition in the repo, so no behaviour
     change).
   - `INTERACTION_KIND_LABELS: Record<InteractionKind, { key: string; fallback: string }>` —
     the i18n-keyed shape `references/ReferenceTimeline.tsx:27-47` already uses, under the
     framework namespace `crm.entity360.activity.kind.<kind>`. Hardcoding an English map at the
     framework layer is forbidden (contract §13 rule 6, AD-18 at `.../ARCHITECTURE-SPINE.md:143`);
     rendering goes through `useTranslate()` with the `_:` fallback, exactly as
     `ReferenceTimeline.tsx:196` does today.

   The six keys are added to `providers/commons/englishCrmMessages.ts` and
   `frenchCrmMessages.ts`. Both existing duplicated maps are **deleted** and both components
   import the shared one: `ShidduchTimeline.tsx:19-26` and `ReferenceTimeline.tsx:27-47`. Two
   deliberate wording changes fall out and are asserted by test:
   - `link_created` / `link_removed` become **"Linked to a shidduch" / "Unlinked from a
     shidduch"**. The only writer of those rows is `create_reference_link`
     (`02_functions.sql:2071-2076`), which always writes `target_type = 'reference'` with
     `metadata = {shidduchim_id}`. So `ShidduchTimeline`'s "Linked to a reference" labels a row
     that no code path produces, and `ReferenceTimeline`'s "Linked to a single" is factually
     wrong — a `reference_link` joins a reference to a **shidduch**.
   - The now-dead `crm.references.timeline.kind.*` block (`englishCrmMessages.ts:437-444` and
     its French counterpart) is removed.

8. **`ActivityTab` renders a read-only, paginated, newest-first feed for any of the four
   target types.** `src/components/atomic-crm/entity360/tabs/ActivityTab.tsx` exports a
   component taking **exactly** `UniversalTabProps` (contract §8) and nothing else. This story
   is the first universal tab, so it also creates
   `src/components/atomic-crm/entity360/tabs/types.ts`:

   ```ts
   import type { Identifier } from "ra-core";
   import type { EntityTargetType } from "../../types";
   export type UniversalTabProps = { targetType: EntityTargetType; targetId: Identifier };
   ```

   The feed is built on **`ListBase` from `ra-core`** — not on a bare `useGetList`:

   ```tsx
   <ListBase<Interaction>
     resource="interactions"
     disableSyncWithLocation
     filter={{ target_type: targetType, target_id: targetId, "deleted_at@is": null }}
     sort={{ field: "created_at", order: "DESC" }}
     perPage={20}
     loading={<ActivitySkeleton />}
     empty={<ActivityEmpty />}
     error={<ActivityError />}
   >
     <ActivityFeed />
     <ListPagination rowsPerPageOptions={[20, 50]} />
   </ListBase>
   ```

   **There is no `ListPaginationContextProvider` in `ra-core`** — only the raw
   `ListPaginationContext` and a 10-field `ListPaginationContextValue`
   (`node_modules/ra-core/dist/controller/list/ListPaginationContext.d.ts`), and
   `useListPaginationContext` **throws** when the context is absent
   (`useListPaginationContext.js:16`), which would be a hard crash inside
   `@/components/admin/list-pagination.tsx:56`, not a degraded render. `ListBase` calls
   `useListController` and wraps its result in `ListContextProvider`, which supplies
   `ListPaginationContext` with all ten fields (`ListContextProvider.js:36`) — so
   `<ListPagination>` works with no hand-synthesised context. Do not hand-roll one.

   `disableSyncWithLocation` is required: it keeps the tab's paging out of the URL (the URL
   belongs to the 360's route shape, UX-DR2) and defaults `storeKey` to `false`
   (`useListParams.js:59`), so two 360s open in sequence do not share a page number.

   Each row shows the translated kind label, `formatTimelineDate(created_at)`, and `body` when
   present. **Falsifiable:** for a fixture of three interactions the rendered order is strictly
   newest-first; with 25 rows exactly 20 render and the pagination control advances to the
   remaining 5.

9. **A referenced record renders via `RecordLink`, and an unknown one degrades to plain text.**
   Rows carry a mention when `metadata` matches one of exactly two recognised shapes:
   - `{ linkedResource: string; linkedId: Identifier }` — the forward-looking convention; renders
     `<RecordLink resource={linkedResource} id={linkedId}>`.
   - `{ shidduchim_id: number }` — **the one shape a live writer produces today**
     (`create_reference_link`, `02_functions.sql:2071-2076`, and the merge collision rows at
     `:2422-2432`); renders `<RecordLink resource="shidduchim" id={shidduchim_id}>`. This is what
     makes `epics.md:523`'s *"entries link to related records via `RecordLink`"* reachable on
     production data rather than only in fixtures.

   The shapes are checked **in that order** and at most **one** mention renders per row: if a
   row carries both, `{linkedResource, linkedId}` wins. A row renders at most one mention, never
   a list.

   Everything else renders plain text — explicitly including `{ merged_from_reference_id }`
   (`02_functions.sql:2500-2506`), whose referent is **deleted by the same function** two
   statements later, so linking it would produce a guaranteed dead link.

   `metadata` is free-form client-writable `jsonb` (`06_grants.sql:615-616` grants
   `update (body, metadata)`), so a malformed value must never break the feed: the shape check
   is a runtime guard, not a cast, and `RecordLink` itself degrades to an inert `<span>` plus
   one `console.error` for an unregistered resource (contract §7 rule 2). **Falsifiable:** a
   fixture row with `metadata = { linkedResource: "nope", linkedId: 1 }` and another with
   `metadata = { linkedResource: 5 }` both leave the remaining rows rendered and the tab
   interactive.

   **Stated limitation:** no SQL writer populates the `{linkedResource, linkedId}` shape today.
   Teaching the `02_functions.sql` writers to emit it is **not** this story's work and is
   **not** unowned — it belongs to the Epic 5 story that migrates each surface onto
   `Entity360` (5.1 for shidduchim, 5.10 for references), because only then is there a
   descriptor whose `buildRecordPath` the link should resolve through.

10. **The `db` suite proves the boundary, with one login holding two contexts.** A new
    `supabase/tests/interactions_targets.sql` + `interactions_targets.test.ts` pair, following
    the harness shape of `context_rls_hardening.test.ts:23-60` (`isolatedScript()`, one JSON row
    per check, `bailIfDbUnreachable` from `dbSuiteHelpers.ts:16-27`) and the fixture shape of
    `context_resolution.sql:33-45` — **one login with active memberships in households A and
    B, active in A**, never two disjoint users (contract §13 rule 3; two disjoint users pass
    without ever exercising `current_context_id()`'s active-context resolution). The login also
    holds a membership of a third, `shadchanus`-kind account for check (f). Role switching uses
    the established `set local role authenticated;` + `set local request.jwt.claims =
    '{"sub":"…","role":"authenticated"}'` / `reset role;` idiom
    (`context_rls_hardening.sql:77-78,111`). Required checks:

    a. Inserting a `shadchan`-targeted and a `single`-targeted interaction in A succeeds
       (AC 1). With the fourth `scope_link_check` branch reverted, both raise.
    b. While active in A, the caller reads its own `shadchan`/`single`-targeted rows and **zero**
       of B's; after `set_active_context(B)` the visibility swaps (AC 3, `using`).
    c. While active in A, an insert whose `target_id` is **B's** shadchan (or single) is
       rejected by the refined `with check` (AC 3, target integrity).
    d. An insert supplying a spoofed `actor_member_id` lands with the caller's real
       `current_member_id()` (AC 4).
    e. `delete from public.singles where id = …` leaves zero `interactions`, `tasks` and
       `identity_signals` rows for that id; likewise for `shadchanim` (AC 5).
    f. **3-14's guarantee, asserted at the trigger layer only.** `pg_trigger` holds no
       `validate_interactions_household_scope` on `public.interactions`, and an insert of an
       `interactions` row whose `account_id` is a `shadchanus` account succeeds when performed
       **as `postgres`** (i.e. with `reset role`, before any `set local role authenticated`), so
       RLS is not in the picture. Re-adding that trigger turns this check red.

       It is deliberately **not** an authenticated insert: AC 3's `exists` clauses require the
       target row to be visible in the active context, and `references`/`shadchanim`/`singles`
       are all still household-only, so no target legal for an authenticated caller exists inside
       a shadchanus context yet. That is the intended end state, not a gap — see Dev Notes,
       "What 3-14 does and does not unlock". Epic 8.5 adds the branch its own target type needs.
       Do not "fix" this by loosening AC 3.

    This is the story's `.claude/rules/security-triggers.md`-mandated negative test. Every check
    must be **shown red once** against a deliberately reverted schema before it is shown green
    (contract §13 rule 2), the way `context_rls_hardening.sql:21-25` documents having done it.

11. **FakeRest stays in sync (AD-10).** `assertValidInteraction`
    (`providers/fakerest/dataProvider.ts:95-123`, called at `:463`) mirrors the database's
    structural guarantees and today rejects any `target_type` other than
    `'reference'`/`'shidduch'` and knows only the three old scope branches. It is widened in
    lockstep with AC 1 — same four target types, same fourth branch — and its doc comment
    (`:85-94`) updated. `dataProvider.interactions.test.ts` gains: one accept case per new
    target type, and a reject case for a `shadchan`-targeted row claiming `scope = 'shidduch'`.
    Without this, demo mode rejects rows the real backend accepts and this story's own
    fakerest-backed component tests cannot cover the two new target types.

    The `deleted_at@is: null` filter must also work in demo mode: `transformFilter.ts:26-29`
    maps `@is` to FakeRest's `_eq`, so the interactions data generator writes an explicit
    `deleted_at: null` on every row. **Falsifiable:** an `ActivityTab` test against the FakeRest
    provider with a `deleted_at`-set row present renders every other row and not that one. If
    `_eq: null` proves not to match, the fix is in the FakeRest adapter — **never** a
    client-side `.filter()` in `ActivityTab`, which would silently disagree with the real
    backend's paging and totals.

12. **Empty, loading and error states render (UX-DR11).** Loading shows a `Skeleton`-based
    placeholder in the existing idiom (`shidduchim/ShidduchShow.tsx:46-58`); empty shows a
    plain inline translated message in the idiom of `ShidduchTimeline.tsx:120-123` — the
    tab-level empty state does **not** get `misc/EmptyState.tsx`'s CTA treatment, which is for
    whole-page emptiness; a fetch error shows a translated message, never a blank tab. All
    three are `ListBase`'s `loading` / `empty` / `error` props (`ListBase.js:40,81-98`), so the
    branch logic is the framework's and not re-implemented.

## Tasks / Subtasks

- [x] **Task 1 — Schema: widen `interactions`, add `deleted_at`** (AC: 1, 2, 6)
  - [x] Edit `01_tables.sql`'s `interactions_target_type_check` (`:458-460`) and
        `interactions_scope_link_check` (`:473-476`) exactly as AC 1 specifies; add the
        `deleted_at` column.
  - [x] Rewrite the two comment blocks (`:438-451`, `:465-472`) for four target types and
        replace "candidate" at `:451` (AC 2).
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        widen_interactions_targets`. A CHECK-constraint change is a normal
        `ALTER TABLE … DROP CONSTRAINT … / ADD CONSTRAINT …` pair plus one `ADD COLUMN`;
        confirm the diff is exactly that and not a `DROP TABLE`/`CREATE TABLE` pair. Generated
        migrations are never applied unread [Source: AGENTS.md#Database-Management].

- [x] **Task 2 — Schema: RLS, `current_member_id()`, the actor trigger, the purge triggers**
      (AC: 3, 4, 5)
  - [x] Rework the `scope = 'account'` disjunct of `"Interactions scoped to account and parent
        visibility"` (`05_policies.sql:262-313`) in `using` **and** `with check`, and update the
        Epic-6 instruction in its comment (`:255-261`).
  - [x] Add `current_member_id()` to `02_functions.sql` beside `current_context_id()`
        (`:201-221`) in exact `pg_dump` form; add `set_interaction_actor_member_id()` in the
        shape of `set_account_id_default()` (`:359-369`); attach the `before insert on
        public.interactions` trigger in `04_triggers.sql` next to `set_interactions_account_id`
        (`:131-133`).
  - [x] Grant/revoke `current_member_id()` in `06_grants.sql` following `:224-227`.
  - [x] Replace the two inline member-id lookups (`02_functions.sql:2128-2132`, `:2381-2385`)
        with `public.current_member_id()`.
  - [x] Add `purge_single_dependents` and `purge_shadchan_dependents` to `04_triggers.sql`,
        copying `:109-111` / `:118-120`.
  - [x] `db diff -f …` (prefer one migration for the whole story unless splitting makes the
        diff easier to hand-check), hand-check, then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.

- [x] **Task 3 — The `db` suite** (AC: 10)
  - [x] Write `supabase/tests/interactions_targets.sql` + `interactions_targets.test.ts` with
        checks (a)–(f). A new pair rather than an extension of `references_entity.sql`: this
        suite's fixture is one login in two contexts, which that file does not have.
  - [x] Prove each check red against a reverted schema, then green. Record which reversion was
        used for each, in the SQL file's header comment, as
        `context_rls_hardening.sql:21-25` does.

- [x] **Task 4 — TS types and the schema guard** (AC: 6)
  - [x] `types.ts:477` → `EntityTargetType`; add `deleted_at?: string | null` to `Interaction`.
  - [x] Remove `interactions_target_type_check` from `PENDING_DB_WIDENINGS` and run 3.9's
        `?raw` guard.
  - [x] `npm run typecheck`.

- [x] **Task 5 — `interactionLabels.ts` and its two existing consumers** (AC: 7)
  - [x] Create `entity360/tabs/interactionLabels.ts` with `formatTimelineDate` and
        `INTERACTION_KIND_LABELS`.
  - [x] Add `crm.entity360.activity.kind.*` to `englishCrmMessages.ts` and
        `frenchCrmMessages.ts`; delete the dead `crm.references.timeline.kind` block from both.
  - [x] Delete the local maps in `ShidduchTimeline.tsx:12-26` and `ReferenceTimeline.tsx:27-47`
        and import the shared module. `ReferenceTimeline` already calls `useTranslate()`;
        `ShidduchTimeline` gains it.

- [x] **Task 6 — `ActivityTab.tsx` + `entity360/tabs/types.ts`** (AC: 8, 9, 12)
  - [x] Create `entity360/tabs/types.ts` with `UniversalTabProps`.
  - [x] Build `ActivityTab.tsx` on `ListBase` + `ListPagination` per AC 8, with the AC 9 mention
        branch and the AC 12 states.

- [x] **Task 7 — FakeRest parity** (AC: 11)
  - [x] Widen `assertValidInteraction` (`providers/fakerest/dataProvider.ts:95-123`) and its
        doc comment; extend `dataProvider.interactions.test.ts`.
  - [x] Make the interactions data generator write `deleted_at: null`.

- [x] **Task 8 — Component tests** (AC: 8, 9, 11, 12)
  - [x] `ActivityTab.test.tsx` under the `app` project: one `it` per target type; plus loading
        skeleton, empty state, error state, newest-first ordering, 20-per-page + advance, the
        `RecordLink` branch, the `{shidduchim_id}` branch, the malformed-`metadata` branch, and
        the soft-deleted-row exclusion.
  - [x] `interactionLabels.test.ts`: the two changed link labels, and that every
        `InteractionKind` has an entry (a `Record<InteractionKind, …>` makes this a compile-time
        guarantee — the test's job is the *label text*, so assert the strings, not the keys'
        existence).

- [x] **Task 9 — Validation** — `npm run typecheck`, `npx vitest run`, `npm run test:unit:db`,
      `npm run lint`, `npm run build` [Source: package.json:6,10,14,17,20 — equivalently
      `make typecheck` / `make test` / `make lint` / `make build`].

## Dev Notes

### What 3-14 does and does not unlock

3-14 drops `validate_interactions_household_scope` (`04_triggers.sql:195-197`) and
`validate_tasks_household_scope` (`:207-209`), so `interactions.account_id` may now be a
`shadchanus` context. It does **not** widen RLS. AC 3's target-integrity `exists` clauses still
require the target row to be visible in the **active** context — and `public.shadchanim` and
`public.singles` remain household-only (`validate_shadchanim_household_scope`,
`validate_singles_household_scope`, untouched by 3-14). So a `shadchan`- or `single`-targeted
interaction is still, correctly, a household-context row: you cannot log an interaction against
a target you cannot see.

That is the intended end state, not a gap. What 3-14 unlocks is that `interactions` **as a
table** now accepts a shadchanus `account_id` at all; Epic 8.5 adds its own target type
(`'connection'`, contract §8 rule 4) and its own `exists` branch in the same policy when it
needs one. AC 10f therefore asserts only the trigger-layer fact, as `postgres` — an
authenticated shadchanus-context insert would still, correctly, be denied by AC 3's
target-integrity clauses, because there is no target row it could name in that context yet.

If a reviewer reads that as "3-14 changed nothing for interactions": it changed the failure
mode from a raw `check_violation` exception raised by a trigger *before* RLS ever runs, to an
ordinary RLS denial that Epic 8.5 can lift by adding one branch. That is exactly the difference
between a structural block and an extensible one.

### Why the `scope_link_check` branch is not optional (the easy-to-miss part)

`interactions_scope_link_check` is written as an **exhaustive, total** predicate over
`(scope, target_type, reference_link_id)`. The schema says so twice: the policy comment —
*"There is no third state a row can fall into"* (`05_policies.sql:242-247`) — and the table
comment — *"Without this discriminator a row with a null reference_link_id silently fell through
BOTH branches"* (`01_tables.sql:449-451`). Both are the schema's own record of implementing
AD-3's "any state left unclassified" prevention
[Source: `.../ARCHITECTURE-SPINE.md:70-71`]; the words are the schema's, not the spine's.
Widening `target_type_check` alone lets a `shadchan`/`single`-targeted row pass the target-type
check and then fail the scope-link check on **every** insert. Get the fourth branch in before
testing anything else, or every subsequent failure looks like an RLS bug.

### Consequence this story creates for Epic 6

`single`-targeted interactions are account-scoped by construction (AC 1). The `scope` comment
at `01_tables.sql:445-447` states that the account bucket is one *"the future single policy
denies wholesale"*, and `05_policies.sql:255-261` says the same. Taken literally, a
`single`-role member would be denied the notes written **about them** on their own 360. That is
a real Epic 6 design decision, not a defect this story can settle — record it in the rewritten
comment (AC 2) so Epic 6 meets it as a written question rather than discovering it in
production. It does not change any acceptance criterion here.

### Trigger mechanics

`set_interaction_actor_member_id` is the **second** BEFORE INSERT trigger on `interactions`
(the first is `set_interactions_account_id`, `04_triggers.sql:131-133`). Postgres fires
same-event BEFORE triggers in alphabetical **name** order, and here the order is irrelevant:
neither reads the other's output — `current_member_id()` resolves through
`current_context_id()`, not through `new.account_id`. The name is singular
(`set_interaction_…`) rather than matching the `set_<table>_…` convention because contract §12
fixes it as the symbol 3.6 depends on; do not "correct" it in this story.

`current_member_id()` returns **NULL** when there is no active context, because
`current_context_id()` does (`02_functions.sql:201-221`, fail-closed by design). A NULL
`actor_member_id` is legal (`01_tables.sql:454` is nullable) and correct — such a caller cannot
insert at all, since RLS's `account_id = public.current_context_id()` is NULL-false.

Two behaviour changes the trigger causes, both intended: rows written by
`create_reference_link` (`02_functions.sql:2071-2076`) previously had `actor_member_id = null`
and are now attributed to the caller; rows written by `log_reference_call` and
`merge_references` already computed the same value inline and are unchanged once AC 4's
replacement lands.

### The `exists` checks carry no `status` filter — deliberately

`public.singles` has a `status` column (`01_tables.sql:210-223`, default `'active'`);
`public.shadchanim` has none (`:226-236`). An archived single's activity history stays readable,
which is what an audit timeline should do, and a symmetric filter is impossible for shadchanim
anyway. Do not add one.

### Reuse already confirmed

- `references/ReferenceTimeline.tsx:27-47` — the i18n-keyed `{key, fallback}` label shape AC 7
  generalises. `:166-170` is the `useGetList<Interaction>` filter shape; `:178-187` the
  loading/empty idiom.
- `shidduchim/ShidduchTimeline.tsx:12-17` (`formatTimelineDate`), `:97-101` (filter shape),
  `:115-123` (skeleton + empty).
- `@/components/admin/list-pagination.tsx:40-56` — reads `useListPaginationContext()`, which
  `ListBase` supplies.
- `01_tables.sql:729` — `interactions_target_idx (account_id, target_type, target_id,
  created_at desc)` already indexes exactly this story's query, including its sort direction.
  No new index is needed.
- `supabase/tests/context_resolution.sql:33-45` — the one-login-two-contexts fixture;
  `context_rls_hardening.test.ts:23-60` — the runner shape.
- `src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,60-72` — the component-test
  shape: `vitest-browser-react`'s `render`, `TestMemoryRouter` + `CoreAdminContext` +
  `testI18nProvider`.

### Testing standard

`app` project (browser-mode vitest in real Chromium, `vitest-browser-react` +
`TestMemoryRouter` from `ra-core`) for `ActivityTab.test.tsx` and `interactionLabels.test.ts`;
`db` project (`npm run test:unit:db`, needs the local stack up) for the SQL suite. **React
Testing Library is not a dependency** — no `screen.queryByText`, no `MemoryRouter`. The negative
idiom is `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`. AAA, no
`waitForTimeout`, ≥80% coverage on new code
[Source: `.claude/rules/testing.md`; contract §13].

### Migration workflow

Edit `supabase/schemas/*.sql` → `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff
--local -f <name>` → hand-check → `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up
--local`. Never `db reset --local` outside a deliberate rehearsal, never `db push`
[Source: AGENTS.md#Database-Management; memory/supabase-cli-dbus-hang.md]. Every table grant
stays paired with its sequence revoke (`06_grants.sql:460-462` for `interactions_id_seq`) — this
story adds no table, so no new pair is needed.

### Project Structure Notes

`src/components/atomic-crm/entity360/tabs/` does not exist yet; this story creates it, adding
`types.ts`, `interactionLabels.ts`, `ActivityTab.tsx` and their tests. Keeping the labels out of
`ActivityTab.tsx` is not gold-plating — 3.6 imports the same module, and a second copy is
exactly what AC 7 exists to remove.

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:512-523`] — Epic 3, Story 3.5
- [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md`] — §7 (`RecordLink`), §8
  (universal tab props, target-type vocabulary, purge rule), §10 (ownership), §11 Ruling 1
  (3-14), §12 (build order), §13 (test shapes)
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:57,60`]
  — AD-1: one polymorphic table, `current_context_id()`-scoped, target-scope integrity
- [Source: `.../ARCHITECTURE-SPINE.md:68,70-71`] — AD-3: the exhaustive-classification
  precedent this story's constraint widening must not violate
- [Source: `.../ARCHITECTURE-SPINE.md:143`] — AD-18: internationalized UI
- [Source: `.../ARCHITECTURE-SPINE.md:148,151`] — AD-19: `current_context_id()`
- [Source: `.../ARCHITECTURE-SPINE.md:172,175`] — AD-23: `single`, never "candidate"/"child"
- [Source: `.../ARCHITECTURE-SPINE.md:177,180`] — AD-24: one shell, one route convention, one
  `RecordLink`
- [Source: `.../ARCHITECTURE-SPINE.md:190`] — Consistency Conventions: single-owner logic
- [Source: `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:166-167`]
  — UX-DR4 shared tab vocabulary (Activity is one of the six)
- [Source: `.../amendment-a2.md:168-172`] — UX-DR5: Activity is on all four entity 360s
- [Source: `.../amendment-a2.md:173-175`] — UX-DR6: every record mention is a `RecordLink`
- [Source: `.../amendment-a2.md:186-187`] — UX-DR11: empty, loading and error states
- [Source: `supabase/schemas/01_tables.sql:425-477`] — the `interactions` table, its four check
  constraints and their comments; `:458-460` `target_type_check`, `:473-476` `scope_link_check`,
  `:454` `actor_member_id`, `:457` `metadata`
- [Source: `supabase/schemas/01_tables.sql:710`] — `account_members_account_user_active_uq`, the
  **partial** unique index behind AC 4's archived-row bug
- [Source: `supabase/schemas/01_tables.sql:729`] — `interactions_target_idx`, already covering
  this story's query and sort
- [Source: `supabase/schemas/02_functions.sql:201-221`] — `current_context_id()`: the exact
  `pg_dump` shape `current_member_id()` copies, and its `status = 'active'` filter at `:216`
- [Source: `supabase/schemas/02_functions.sql:359-369`] — `set_account_id_default()`, the shape
  `set_interaction_actor_member_id()` mirrors
- [Source: `supabase/schemas/02_functions.sql:1799-1817`] — `purge_polymorphic_dependents()`,
  used unmodified by AC 5
- [Source: `supabase/schemas/02_functions.sql:2071-2076,2422-2432,2500-2506`] — every live
  writer of `interactions.metadata`, and the shapes AC 9 recognises
- [Source: `supabase/schemas/02_functions.sql:2128-2132,2381-2385`] — the two inline
  member-id lookups AC 4 replaces
- [Source: `supabase/schemas/04_triggers.sql:109-111,118-120`] — the two existing purge
  triggers AC 5 copies; `:131-133` `set_interactions_account_id`; `:195-197`,`:207-209` the two
  triggers 3-14 drops
- [Source: `supabase/schemas/05_policies.sql:234-261,262-313`] — the policy comment and the
  policy AC 3 refines
- [Source: `supabase/schemas/06_grants.sql:224-227`] — the grant/revoke pattern for a
  `SECURITY DEFINER` function; `:412-422` and `:595-597` the `interactions` grants (DELETE
  withheld); `:611-616` the column-scoped UPDATE that makes `metadata` client-writable
- [Source: `src/components/atomic-crm/types.ts:475-487`] — `Interaction`; `:477` the two-value
  `target_type` AC 6 widens
- [Source: `src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx:12-17,19-26,97-101,115-123`]
- [Source: `src/components/atomic-crm/references/ReferenceTimeline.tsx:27-47,166-170,178-187`]
- [Source: `src/components/atomic-crm/providers/commons/englishCrmMessages.ts:433-445`;
  `providers/commons/i18nProvider.ts:16-21`] — the catalog block AC 7 replaces, and why a
  missing French key falls back to English
- [Source: `src/components/atomic-crm/providers/fakerest/dataProvider.ts:85-123,463`] —
  `assertValidInteraction`, widened in lockstep (AD-10)
- [Source: `src/components/atomic-crm/providers/fakerest/internal/transformFilter.ts:26-29`] —
  `@is` support behind the `deleted_at@is: null` filter
- [Source: `src/components/atomic-crm/providers/fakerest/dataProvider.interactions.test.ts`] —
  the parity-test shape AC 11 extends
- [Source: `src/components/admin/list-pagination.tsx:40-56`] — `ListPagination`
- [Source: `node_modules/ra-core/dist/controller/list/ListPaginationContext.d.ts`;
  `useListPaginationContext.js:16`; `ListContextProvider.js:36`; `ListBase.js:40,66-98`;
  `useListParams.js:59`] — why `ListBase`, and why there is no `ListPaginationContextProvider`
- [Source: `supabase/tests/context_resolution.sql:33-45`;
  `supabase/tests/context_rls_hardening.test.ts:23-60`; `supabase/tests/dbSuiteHelpers.ts:16-27`]
  — the `db` suite fixture and runner shapes
- [Source: `src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,60-72`] — the
  browser-mode component-test shape
- [Source: `.claude/rules/security-triggers.md`, `.claude/rules/testing.md`,
  `.claude/rules/coding-style.md`, `.claude/rules/english-only.md`,
  `.claude/rules/lsp-usage.md`]
- [Source: `_bmad-output/implementation-artifacts/3-9-recordlink-primitive.md`,
  `3-3-entity-descriptor-registry.md`, `3-10-tab-vocabulary.md`,
  `3-14-context-scope-lift-tasks-interactions.md`] — this story's blocking dependencies

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), dispatched as the harness `developer` role
via the `bmad-dev-story` skill.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f widen_interactions_targets`
  produced exactly one `DROP CONSTRAINT`/`ADD CONSTRAINT` pair plus one `ADD COLUMN` on
  `interactions`, four `CREATE OR REPLACE FUNCTION` (new `current_member_id()`,
  `set_interaction_actor_member_id()`, and the two rewritten `log_reference_call`/
  `merge_references` bodies), one `DROP POLICY`/`CREATE POLICY` pair, and three
  `CREATE TRIGGER` statements — no `DROP TABLE`/`CREATE TABLE`. `supabase db diff` did not
  capture the two new functions' `REVOKE`/`GRANT` statements (a known quirk, AGENTS.md's own
  "sometimes manual adjustment is needed"); added by hand into the generated migration to match
  `06_grants.sql`.
- Confirmed `pg_dump --local --schema public` renders `current_member_id()` and
  `set_interaction_actor_member_id()` in the exact same shape as `current_context_id()` /
  `set_account_id_default()` (`CREATE OR REPLACE FUNCTION "public"."name"() … LANGUAGE
  "plpgsql" [STABLE SECURITY DEFINER] SET "search_path" TO ''`).
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local` (after `migration up`) →
  "No schema changes found".
- `interactions_targets.sql` red rehearsal: migration file moved out of
  `supabase/migrations/`, `supabase db reset --local`, suite re-run. Results: AC 10(a) both
  inserts fail (`violates check constraint interactions_scope_link_check` — Postgres evaluated
  that constraint before `interactions_target_type_check` for this row shape; either is a valid
  red signal per AC 1's own Dev Notes); AC 10(b) the two "caller sees its own row" assertions
  fail, the "zero of B's" arms pass vacuously (no fixture); AC 10(c)'s embedded sanity swap is
  collateral-red (the insert is blocked by the type/scope-link check before it ever reaches the
  policy — expected, and exactly why the swap technique rather than a full revert is (c)'s real
  falsifiability proof); AC 10(d) fails (`function public.current_member_id() does not exist`);
  AC 10(e)'s shadchan/tasks arm fails (task row survives, no purge trigger), its interactions
  arms pass vacuously (fixture insert blocked by the type check, same shape as (c)); AC 10(f) is
  unaffected by the revert (3-14's own guarantee) and its own embedded sanity re-attachment of
  `validate_interactions_household_scope` still turns it red live. Migration restored,
  `db reset --local` re-run: all 25 checks green.
- `pendingDbWidenings.test.ts`'s two red-run assertions (`tasks_target_type_check` removal,
  and the new `interactions_target_type_check` revert-fixture test) both confirmed to fail
  before this story's TS edits landed, and pass after.
- `make test STACK_ID=2` (full suite, all projects): 134 files / 1385 tests passed. `npm run
  typecheck`, `npm run lint`, `npx prettier --check` (scoped to files this story owns), and
  `npm run build` all clean.
- Security review (security-review skill) performed on the full diff: no findings. The RLS
  policy's target-integrity `exists` clauses, `current_member_id()`'s scoping, and the
  actor-attribution trigger's overwrite semantics were checked specifically for cross-account
  bypass paths; none found.

### Completion Notes List

- All 9 tasks and all 12 ACs implemented and verified; see the gate output above.
- `01_tables.sql`/`05_policies.sql`/`02_functions.sql`/`04_triggers.sql`/`06_grants.sql` edited
  exactly per the story's line-anchored instructions (the repo's real line numbers had already
  drifted a few lines from the story's citations by the time this story started — content
  matched, not the exact line numbers quoted).
- `pendingDbWidenings.test.ts` (existing file, in-scope for this story) needed two updates
  beyond what the story's Task 4 called out: the "parses the real interactions_target_type_check
  values" test's expected array (2 values → 4), and the "fails when interactions_target_type_check
  is removed from the pending list" test — which is no longer meaningful once the constraint is
  fully at parity (removing an already-absent entry from `PENDING_DB_WIDENINGS` is a no-op) — was
  replaced with a test that proves the same falsifiable claim (AC 6) directly against
  `extractTargetTypeCheckValues`/`isAtParityWithEntityTargetTypes` using a literal
  pre-Story-3.5 fixture string, rather than re-deriving a fixture from the live schema file.
- `interactions_targets.sql`'s AC 10(c) (target-integrity `with check`) cannot be isolated by a
  full-migration revert, because AC 1 (type widening) and AC 3 (target-integrity) ship in the
  same migration — reverting the whole thing blocks the insert at the type-check stage before
  the policy is ever reached, proving nothing about the `with check` clause specifically. Used
  an in-suite transient policy swap instead (drop the real policy, install the pre-Story-3.5
  bare `scope = 'account'` version, show the cross-context insert WRONGLY succeed, restore the
  real policy, show it now correctly denied) — the same technique
  `context_rls_hardening.sql` uses to isolate its DELETE policy's own contribution. Same
  technique reused for AC 10(f)'s sanity check (transiently re-attach
  `validate_interactions_household_scope`).
- AC 10(e)'s `tasks`/`single` and every `identity_signals` arm are vacuously true, not because
  the purge trigger doesn't work, but because the target type can't reach that table yet:
  `tasks_target_type_check` doesn't accept `'single'` until Story 3.8, and
  `identity_signals_target_type_check` never accepts `'single'`/`'shadchan'` at all (a
  different, AD-5 vocabulary — `pendingDbWidenings.test.ts`'s own header explains why). Documented
  in the SQL file rather than silently passing.
- `RecordLink`'s rendered mention text ("View record", translated) is this story's own design
  choice — the contract specifies the mention renders via `RecordLink`, not what text it shows,
  and fetching the target record's own representation for a label would be an extra query per
  row the contract does not ask for.
- `ReferenceTimeline.tsx`'s own `new Date(...).toLocaleString()` date rendering was left
  untouched — `formatTimelineDate` was ShidduchTimeline's helper, moved verbatim (AC 7 says "no
  behaviour change"); ReferenceTimeline never used it, so switching it now would be an
  unrequested behaviour change smuggled into a "no behaviour change" story.
- Found and reported (not "fixed", since it's cross-story and outside this story's owned
  paths) a pre-existing, unrelated flake: `references/ReferenceCreate.test.tsx` failed
  intermittently against `src/components/atomic-crm/references/ReferenceCreate.tsx`, which was
  already modified, uncommitted, by a concurrent agent's in-progress work at the time this story
  ran its validation suite. Confirmed via `git status` that this file (and its untracked test)
  were not touched by this story and are outside its ownership list. The flake did not
  reproduce in the final full-suite run.
- Two items flagged as worth the contract owner's attention (not defects blocking this story):
  (1) Dev Notes' "Trigger mechanics" section states `set_interaction_actor_member_id` is "the
  **second** BEFORE INSERT trigger" — alphabetically it actually sorts *before*
  `set_interactions_account_id` (`'_'` < `'s'` in `set_interaction_` vs `set_interactions_`),
  so it fires first, not second. Functionally immaterial, exactly as the same Dev Notes
  paragraph says ("the order is irrelevant: neither reads the other's output"), but the
  ordinal claim itself is backwards. (2) `current_member_id()`'s own comment inherited
  verbatim from `current_context_id()`'s framing ("the definer privilege it needs lives inside
  `current_member_id()`") is fine as written for `set_interaction_actor_member_id()`; no
  action needed, noted only because Dev Notes emphasizes it as an easy point of confusion.

### File List

**Modified:**
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/04_triggers.sql`
- `supabase/schemas/05_policies.sql`
- `supabase/schemas/06_grants.sql`
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/entity360/pendingDbWidenings.ts`
- `src/components/atomic-crm/entity360/pendingDbWidenings.test.ts`
- `src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx`
- `src/components/atomic-crm/references/ReferenceTimeline.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.interactions.test.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts`
- `registry.json` (auto-generated by `make registry-gen`)

**Added:**
- `supabase/migrations/20260729025545_widen_interactions_targets.sql`
- `supabase/tests/interactions_targets.sql`
- `supabase/tests/interactions_targets.test.ts`
- `src/components/atomic-crm/entity360/tabs/types.ts`
- `src/components/atomic-crm/entity360/tabs/interactionLabels.ts`
- `src/components/atomic-crm/entity360/tabs/interactionLabels.test.ts`
- `src/components/atomic-crm/entity360/tabs/ActivityTab.tsx`
- `src/components/atomic-crm/entity360/tabs/ActivityTab.test.tsx`

## Change Log

| Date | Change |
|---|---|
| 2026-07-29 | Story implemented end-to-end: `interactions` widened to all four `ENTITY_TARGET_TYPES` (AC 1/2), RLS's `scope = 'account'` disjunct made target-aware (AC 3), `current_member_id()` + server-set `actor_member_id` (AC 4), `purge_single_dependents`/`purge_shadchan_dependents` (AC 5), `types.ts` + `PENDING_DB_WIDENINGS` updated (AC 6), shared `interactionLabels.ts` replacing two duplicated maps with the two AC 7 wording fixes, `ActivityTab.tsx` (AC 8/9/12) on `ListBase` + `ListPagination`, FakeRest parity (AC 11), the `interactions_targets` db suite (AC 10) with a full red/green rehearsal plus in-suite transient-swap isolation for AC 3 and AC 5(f). Status → review. |
