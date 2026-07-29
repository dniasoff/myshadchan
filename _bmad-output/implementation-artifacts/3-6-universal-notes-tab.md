# Story 3.6: Universal Notes tab

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want notes on any record,
so that context lives with the thing it describes.

## Position in Epic 3

Build order and every shared shape come from the Epic 3 canonical API contract
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — §8 (universal tab props
and target-type vocabulary), §11 Ruling 1 (the household-scope lift), §12 (build order, this
story is step 9), §13 (test-shape rules). Do not restate those shapes here; cite them.

**Hard dependencies — exactly two:**

- **3.5 (Activity)** — a note *is* an interaction with `kind = 'note'`, so this story inherits
  3.5's whole backend widening: `interactions_target_type_check` extended to the four values in
  `ENTITY_TARGET_TYPES`, the fourth `interactions_scope_link_check` branch that makes
  `scope = 'account'` legal for `single`/`shadchan` targets, `public.current_member_id()`, the
  `set_interaction_actor_member_id` BEFORE INSERT trigger that stamps `actor_member_id`, the
  `Interaction` type in `types.ts`, `entity360/tabs/types.ts`'s `UniversalTabProps`, and
  `entity360/tabs/interactionLabels.ts` (`formatTimelineDate`, `KIND_LABELS`).
  [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md]
- **3-14 (household-scope lift)** — `validate_interactions_household_scope`
  [Source: supabase/schemas/04_triggers.sql:180-182] fires `enforce_household_scope()`, which
  raises unless the row's account is `kind = 'household'`. Until 3-14 drops that trigger, a
  note on a shadchan in a shadchanus context fails with a raw Postgres exception, and AC 4(h)
  cannot pass. [Source: _bmad-output/planning-artifacts/epic3-api-contract.md — §11 Ruling 1]

**Not a dependency: 3.9 / `RecordLink`.** The Notes tab renders no record mentions — a note
body is plain text and the author is a name, not a link (`members` has no 360 in this epic).
The previous revision of this story declared 3.9 as a dependency and then never rendered a
`RecordLink` in any AC or task; that declaration is deleted rather than given a use.

**Not a dependency: 3.4 / `useViewerRole()`.** Edit/delete affordances are driven by the
`can_moderate` column of AC 5's view, computed server-side by the same predicate the RLS policy
uses. No role is re-derived in TypeScript.

## Scope boundary

This delivers a standalone, tested `NotesTab` component plus its backend. Mounting it into a
live entity's tab bar is Epic 5's job (`tabs` on that entity's descriptor).

It **replaces** the inline `AddNote` sub-component in `shidduchim/ShidduchTimeline.tsx:35-90`
as the canonical way to write a shidduch note — but that replacement (deleting `AddNote` and
mounting `NotesTab` instead) happens when Epic 5 migrates `shidduchim` onto `Entity360`
(Story 5.1). **Do not edit `ShidduchTimeline.tsx` in this story.**

The one file outside `entity360/tabs/` this story edits is `ActivityTab.tsx` (AC 8) — a
one-line filter addition to the query 3.5 built, flagged in 3.5's own Dev Notes as expected.

## Acceptance Criteria

1. **A note is deletable without losing the audit trail — a soft delete.**
   `public.interactions` gains `deleted_at timestamp with time zone` (nullable, no default).
   "Delete a note" sets `deleted_at`; the row is never removed by `DELETE`. This is deliberate,
   not a gap: `authenticated` holds no `DELETE` grant on `interactions`
   [Source: supabase/schemas/06_grants.sql:412-422] — *"DELETE, because a call log somebody can
   quietly erase row by row is worth much less than one they cannot"* — restated at
   [Source: supabase/schemas/06_grants.sql:595-597]. The column-scoped update grant
   [Source: supabase/schemas/06_grants.sql:615-616] widens from `(body, metadata)` to
   `(body, metadata, deleted_at)`, and the comment above it
   [Source: supabase/schemas/06_grants.sql:611-614] is extended to say why `deleted_at` joins
   the client-writable set while the structural columns do not.

   *Falsifiable:* a `db`-project check proves, as one authenticated author, that
   `update public.interactions set deleted_at = now() where id = <own note>` affects 1 row;
   that `update public.interactions set target_id = 999 where id = <own note>` raises
   `permission denied for column`; and that `delete from public.interactions where id = <own
   note>` raises `permission denied for table interactions`.

   A column grant cannot distinguish setting `deleted_at` from clearing it, so an author can
   technically un-delete their own note. Accepted and unchanged from the previous revision:
   the author could equally re-post the same text, no UI offers undelete, and nothing in
   `epics.md` asks for one. [Source: _bmad-output/planning-artifacts/epics.md:525-536]

2. **The existing `for all` policy is split into exactly three per-command policies — SELECT,
   INSERT, UPDATE — and no `for delete` policy is created.**
   `"Interactions scoped to account and parent visibility"`
   [Source: supabase/schemas/05_policies.sql:262-315] is `for all`. Postgres ORs *permissive*
   policies per command, so adding a second, narrower UPDATE policy alongside it would **widen**
   access, not restrict it. The rewrite therefore replaces it with three policies carrying the
   identical `using` (SELECT/UPDATE) and `with check` (INSERT/UPDATE) predicates it has today
   post-3.5. `public.account_members`
   [Source: supabase/schemas/05_policies.sql:143-156] is the in-repo precedent for this exact
   split, and the rationale comment above it
   [Source: supabase/schemas/05_policies.sql:113-142] states the same OR-widening hazard in
   writing. **DELETE gets no policy on purpose** — `authenticated` has no DELETE grant (AC 1),
   so a policy would be dead text implying a capability that does not exist.

   *Falsifiable:* a `db`-project check asserts
   `select array_agg(cmd order by cmd) from pg_policies where schemaname='public' and
   tablename='interactions'` equals `{INSERT,SELECT,UPDATE}` — three rows, no `ALL`, no
   `DELETE`. This fails if a `for all` remnant survives, if a fourth policy is added, or if the
   author check is bolted on as a second permissive UPDATE policy.

3. **Only the note's author, or a member holding an *owning* role, may edit or soft-delete a
   note — decided in one place and used by both the policy and the view.**

   A new helper, in exact `pg_dump` form (see Dev Notes "Migration hygiene"):

   ```sql
   CREATE OR REPLACE FUNCTION "public"."can_moderate_note"("p_actor_member_id" bigint) RETURNS boolean
       LANGUAGE "sql" STABLE SECURITY DEFINER
       SET "search_path" TO ''
       AS $$
     select exists (
         -- the caller wrote it: compare the AUTHOR's membership row on user_id,
         -- never on account_members.id (see Dev Notes "Why authorship joins on user_id")
         select 1
         from public.account_members am
         where am.id = p_actor_member_id
           and am.user_id = auth.uid()
       ) or exists (
         -- or the caller holds an owning role in the context they are active in
         select 1
         from public.account_members am
         where am.user_id = auth.uid()
           and am.account_id = public.current_context_id()
           and am.status = 'active'
           and public.is_owning_membership_role(am.role)
       );
   $$;
   ```

   `public.is_owning_membership_role(text)` [Source: supabase/schemas/02_functions.sql:439-444]
   returns `p_role in ('parent_admin','self_manager')` and exists, per its own comment
   [Source: supabase/schemas/02_functions.sql:434-438], *"so add_persona() and my_personas() can
   never diverge on this list"*. Writing `am.role = 'parent_admin'` here instead is a
   review-blocking defect: it locks a self-managing household — whose only owning membership may
   be `self_manager` — out of moderating its own notes.

   The **UPDATE** policy's predicate is 3.5's visibility predicate, preserved verbatim, ANDed
   with the following clause in **both** `using` and `with check`:

   ```sql
   and (kind <> 'note' or public.can_moderate_note(actor_member_id))
   ```

   In `using` because AC 4's observable is *zero rows affected* — a `with check`-only condition
   raises instead of filtering. In `with check` so an update cannot re-point a row into a state
   the caller could not have targeted. Every other `kind` (`call_logged`, `status_change`,
   `merge`, `link_created`, `link_removed` —
   [Source: supabase/schemas/01_tables.sql:461-463]) keeps today's account-scoped update
   behaviour. The SELECT and INSERT policies from AC 2 carry **no** author clause: this story
   narrows update rights only, and must not change who can read or add.

   Grants for the new function mirror `is_owning_membership_role`'s
   [Source: supabase/schemas/06_grants.sql:291-293]: `revoke all ... from public, anon;`
   `grant execute ... to authenticated;` `grant execute ... to service_role;`.

4. **`db`-project negative matrix — eight named checks, one file.**
   `supabase/tests/interaction_note_authorship.sql` + `interaction_note_authorship.test.ts`,
   following the shape of [Source: supabase/tests/context_rls_hardening.test.ts:1-40] and using
   [Source: supabase/tests/dbSuiteHelpers.ts:15-25]'s `bailIfDbUnreachable`. Each check emits
   one JSON row `{name, passed, detail}` and becomes one named `it`. "Zero rows affected" is
   asserted through `GET DIAGNOSTICS ... ROW_COUNT` in psql, **not** through PostgREST — a
   0-row UPDATE returns 404/`PGRST116` there, which ra-core throws, indistinguishable from a
   policy denial [Source: _bmad-output/planning-artifacts/epic3-api-contract.md — §13 rule 4].

   | # | Check | Expected |
   |---|---|---|
   | a | `helper` updates the note they authored | 1 row |
   | b | `helper` updates a note authored by the `parent_admin` | 0 rows |
   | c | `parent_admin` soft-deletes the `helper`'s note | 1 row |
   | d | in a household whose only owning membership is **`self_manager`**, that member soft-deletes a `helper`'s note | 1 row |
   | e | after the author's membership row is archived (`status='archived'`) and a **new active row** is inserted for the same `(account_id, user_id)`, that login updates the note it authored under the **old** membership id | 1 row |
   | f | one login holding memberships in household A and shadchanus B, **active in B**, updates a note in A | 0 rows |
   | g | `helper` updates a `kind = 'call_logged'` row authored by the `parent_admin` | 1 row |
   | h | in a **shadchanus** context, insert `kind='note'`, `target_type='shadchan'`, `scope='account'`, then read it back | insert succeeds, 1 row visible |

   Each check is chosen because a specific wrong implementation fails it and only it:
   **(d)** fails if the predicate hardcodes `role = 'parent_admin'`. **(e)** fails if authorship
   is resolved as `actor_member_id = public.current_member_id()` — the partial unique index
   `account_members_account_user_active_uq` [Source: supabase/schemas/01_tables.sql:710] is
   `(account_id, user_id) where status = 'active'`, so an archived and an active row coexist
   with different `id`s and a re-added persona is permanently stripped of their own notes.
   **(f)** is the one-login/two-contexts shape the contract requires
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md — §13 rule 3]; two disjoint
   users would pass without ever exercising `current_context_id()`. It also proves the
   preserved account-scope `using` clause still gates the note branch, not just the new author
   check. **(g)** fails if the `kind <> 'note'` escape is dropped and the author check is
   applied to the whole table. **(h)** fails if 3-14 has not landed.

5. **`public.interactions_summary` — author identity resolved server-side, in one query.**
   A new view in `03_views.sql`, `with (security_invoker = on)`, following
   `references_summary` [Source: supabase/schemas/03_views.sql:101] and `singles_summary`
   [Source: supabase/schemas/03_views.sql:170]. Columns: every column of `public.interactions`
   listed **explicitly** (`id, account_id, created_at, target_type, target_id, scope,
   reference_link_id, actor_member_id, kind, body, metadata, deleted_at` — never `i.*`, which
   makes `supabase db diff` unstable), plus:
   - `author_name text` — `nullif(btrim(coalesce(m.first_name,'') || ' ' || coalesce(m.last_name,'')), '')`,
     reached by `left join public.account_members am on am.id = i.actor_member_id`
     `left join public.members m on m.user_id = am.user_id`.
   - `can_moderate boolean` — `public.can_moderate_note(i.actor_member_id)`, the **same**
     function AC 3's policy calls.

   The join key is settled, not open: `account_members.user_id` references `auth.users(id)`
   [Source: supabase/schemas/01_tables.sql:592] and `public.members.user_id` is `not null`
   [Source: supabase/schemas/01_tables.sql:20] with `uq__members__user_id`
   [Source: supabase/schemas/01_tables.sql:25], so `account_members.user_id = members.user_id`
   is a unique join. The author's name is never denormalized onto `interactions`.

   Grants mirror `references_summary` [Source: supabase/schemas/06_grants.sql:442-444]:
   `revoke all on table public.interactions_summary from anon, authenticated;`
   `grant select ... to authenticated;` `grant all ... to service_role;`.

   *Falsifiable:* `db`-project checks assert (i)
   `select reloptions from pg_class where relname='interactions_summary'` contains
   `security_invoker=on`; (ii) for the archive-and-re-add login of AC 4(e), that login reads
   `can_moderate = true` on its own pre-archive note; (iii) a `helper` reads
   `can_moderate = false` on the `parent_admin`'s note; (iv) `author_name` equals the author's
   `first_name last_name` for an active author, and is `null` when the `parent_admin` reads a
   note whose author's membership in this account has since been **archived** — the `members`
   read policy requires an `active` shared membership
   [Source: supabase/schemas/05_policies.sql:18-29], so the LEFT JOIN yields NULL rather than
   an error or a leak.

6. **`NotesTab` renders, adds, edits and soft-deletes.**
   `src/components/atomic-crm/entity360/tabs/NotesTab.tsx` exports a component taking
   **exactly** `UniversalTabProps` — `{ targetType: EntityTargetType; targetId: Identifier }`,
   no extra props, no per-entity variants
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md — §8].
   - **Read:** `useGetList("interactions_summary", { filter: { target_type, target_id, kind:
     "note", "deleted_at@is": null }, sort: { field: "created_at", order: "DESC" }, pagination:
     { page: 1, perPage: 50 } })`. `@is` is a supported operator
     [Source: src/components/atomic-crm/providers/fakerest/internal/transformFilter.ts:26-29]
     with a live precedent
     [Source: src/components/atomic-crm/reminders/useReminders.ts:124].
   - **Render:** body, `author_name` (falling back to a translated label when null), and
     `formatTimelineDate(created_at)` imported from `entity360/tabs/interactionLabels.ts` —
     **imported, never copied** (3.5 moved it there from
     [Source: src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx:13-17]).
   - **Add:** an inline `Textarea` + button posts `useCreate("interactions", …)` with
     `kind: "note"`, the trimmed body, and the AD-3 scope discriminator per target type:
     `shidduch` → `{ scope: "shidduch", reference_link_id: null }`; `reference`, `single`,
     `shadchan` → `{ scope: "account", reference_link_id: null }`. The single/shadchan case is
     legal only because of 3.5's fourth `interactions_scope_link_check` branch
     [Source: supabase/schemas/01_tables.sql:473-477]. `actor_member_id` is **never** sent —
     3.5's trigger stamps it.
   - **Edit / soft-delete:** `useUpdate("interactions", …)` on `body`, and on `deleted_at`
     respectively. Both write to the **table**, not the view.
   - **Cache:** because the read resource (`interactions_summary`) differs from the write
     resource (`interactions`), ra-core's per-resource invalidation does **not** refresh the
     list on its own. Every successful mutation calls `useRefresh()` — the same remedy
     `AddNote` uses today
     [Source: src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx:38,60]. *Falsifiable:*
     a test adds a note and asserts its body appears without remounting the component.
   - **Controls:** edit and delete render only when `row.can_moderate` is true. This is a
     client-side convenience; AC 3's policy is the boundary. A denied attempt surfaces through
     `useNotify` exactly as
     [Source: src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx:61-66] does.

   *Falsifiable:* `NotesTab.test.tsx` asserts, one behaviour per `it`, that a fixture note with
   `can_moderate: false` renders **no** edit control
   (`await expect.element(screen.getByRole("button", { name: /edit/i })).not.toBeInTheDocument()`),
   that one with `can_moderate: true` does, and that the `create` payload for each of the four
   `targetType` values carries the scope pair above.

7. **A soft-deleted note is absent from the list.** The `deleted_at@is: null` filter is proven
   by fixture, not by inspection: `NotesTab.test.tsx` seeds three notes, one with a non-null
   `deleted_at`, and asserts that note's body is not in the document while the other two are.
   Removing the filter fails this test.

8. **`ActivityTab` hides soft-deleted interactions too.** 3.5's `useGetList` in
   `entity360/tabs/ActivityTab.tsx` gains `"deleted_at@is": null`, and `ActivityTab.test.tsx`
   gains one case seeding a soft-deleted row and asserting it is not rendered. `ActivityTab`
   keeps reading the **`interactions` table**, not AC 5's view — Activity needs no author name,
   and switching its resource would rewrite a component and a test suite 3.5 just shipped.
   *Written trigger for revisiting:* the first story that needs an author name on the Activity
   feed swaps `ActivityTab`'s resource to `interactions_summary` — a one-line change, since the
   view is a superset projection.

9. **Empty, loading and error states render, and every user-facing string goes through the
   `i18nProvider`.** Skeleton while pending, an inline "no notes yet" message when empty, a
   friendly message on fetch error — never a blank tab (UX-DR11
   [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:186-187]).
   `entity360/` is framework layer, so no English label map may be cemented there
   [Source: _bmad-output/planning-artifacts/epic3-api-contract.md — §13 rule 6]: strings use
   `useTranslate()` with an `_:` English fallback under the key namespace
   `crm.entity360.notes.*`, the pattern already live at
   [Source: src/components/atomic-crm/layout/ContextSwitcher.tsx:69-79].

   *Falsifiable:* one `it` renders `NotesTab` with an empty result set under a
   `testI18nProvider` [Source: src/components/atomic-crm/providers/commons/i18nProvider.ts]
   that maps `crm.entity360.notes.empty` to a sentinel string, and asserts the **sentinel** is
   on screen. A hardcoded English empty-state string fails this.

## Tasks / Subtasks

- [x] **Task 1 — Schema: soft delete, the split policies, the shared predicate** (AC: 1, 2, 3)
  - [x] Add `deleted_at timestamp with time zone` to `public.interactions` in `01_tables.sql`.
        (Found already present — 3.5 owns this column per contract §10; verified, not added.)
  - [x] Add `public.can_moderate_note(bigint)` to `02_functions.sql`, in exact `pg_dump` form,
        placed beside `is_owning_membership_role` (`:439`). Grant per AC 3.
  - [x] In `05_policies.sql`, replace the single `for all` policy (`:262-315`) with three
        per-command policies. Preserve 3.5's visibility predicate **verbatim** in all three;
        AND the `kind <> 'note' or public.can_moderate_note(actor_member_id)` clause into the
        UPDATE policy's `using` **and** `with check` only. Write no DELETE policy, and say why
        in a comment.
  - [x] Widen the column grant to `(body, metadata, deleted_at)` in `06_grants.sql:616` and
        extend the comment at `:611-614`.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        add_interaction_soft_delete_and_note_authorship`, hand-check the output (expect: one
        `ALTER TABLE ... ADD COLUMN`, one `CREATE FUNCTION`, three `CREATE POLICY` + one
        `DROP POLICY`, grants — and **no** trigger or constraint churn), then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. (No `ALTER
        TABLE` needed — see above. `db diff` also dropped `WITH (security_invoker = on)` on the
        new view and every grant/revoke statement, both hand-added — see Debug Log.)

- [x] **Task 2 — `interactions_summary` view** (AC: 5)
  - [x] Add the view to `03_views.sql` with explicit columns, `security_invoker = on`, and the
        two left joins. Grant per AC 5.
  - [x] Regenerate and hand-check the migration in the same diff as Task 1 if not yet applied,
        or a second one named `add_interactions_summary_view`. (Same diff as Task 1.)

- [x] **Task 3 — FakeRest mirror (AD-10)** (AC: 5, 6)
  - [x] `withSupabaseFilterAdapter` strips the `_summary` suffix
        [Source: src/components/atomic-crm/providers/fakerest/internal/supabaseAdapter.ts:4-8,18-20],
        so `interactions_summary` arrives at the FakeRest provider as `interactions`. Enrich
        the `interactions` `getList`/`getOne` results with `author_name` and `can_moderate`,
        keyed off the base resource name — the same shape as the `references_summary` mirror
        [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:388-399] and the
        note already written at
        [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:211-216].
  - [x] Mirror 3.5's `actor_member_id` trigger on the FakeRest `create` path for
        `interactions`: stamp the demo caller's active membership id via `activeMembershipsFor`
        [Source: src/components/atomic-crm/providers/fakerest/internal/accountMemberships.ts:24-37].
        Without it every demo note carries `actor_member_id: null` (the current generator value
        — [Source: src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts:307])
        and `can_moderate` is false for everything in demo mode. (Added `resolveContextMembership`
        to `accountMemberships.ts` and a `resolveCallerMembership` closure in `dataProvider.ts`
        that the create-path stamp and the enrichment's owning-role check both call.
        `dataGenerator/references.ts` itself was not edited — those rows are `link_created`/
        `call_logged`, not `note`, so NotesTab never reads them; left as the documented
        authorless-legacy-data case rather than backfilled.)
  - [x] `can_moderate` for a null `actor_member_id` follows the SQL: false for the author
        branch, true only if the demo caller holds an owning role. Legacy authorless rows are
        therefore moderatable by owners only — state it in a code comment.

- [x] **Task 4 — The `db` negative matrix** (AC: 4, 5)
  - [x] `supabase/tests/interaction_note_authorship.sql` + `.test.ts`, checks (a)–(h) of AC 4
        plus AC 5's four view checks, one named `it` each. (Check (h) implemented against
        `target_type = 'reference'` rather than `'shadchan'` — see the Debug Log and Completion
        Notes for why the literal AC 4(h) shape is unsatisfiable under the current schema.)
  - [x] Rehearse against a seeded local stack:
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db reset --local` then
        `npm run test:unit:db`.

- [x] **Task 5 — `NotesTab.tsx`** (AC: 6, 7, 9)
  - [x] Build per AC 6, importing `formatTimelineDate` from
        `entity360/tabs/interactionLabels.ts` and `UniversalTabProps` from
        `entity360/tabs/types.ts` (both 3.5's).
  - [x] `NotesTab.test.tsx` (`app` project): add / edit / soft-delete happy paths; the
        `can_moderate` control-visibility pair; the soft-deleted-note-absent case (AC 7); the
        four `targetType` scope payloads; empty / loading / error; the i18n sentinel (AC 9).
        AAA, one behaviour per `it`, no `waitForTimeout`.

- [x] **Task 6 — `ActivityTab` filter** (AC: 8)
  - [x] Add `"deleted_at@is": null` to `ActivityTab.tsx`'s `useGetList` filter and one case to
        `ActivityTab.test.tsx`. Touch nothing else in that file. (Verified both were already
        present — 3.5 shipped them ahead of this story's dependency; neither file was edited.)

- [x] **Task 7 — Validate**
  - [x] `npm run typecheck` · `npx vitest run` · `npm run test:unit:db` · `npm run lint` ·
        `npm run build`. (Equivalently `make typecheck` / `make test` / `make lint` /
        `make build`.)

## Dev Notes

### Why authorship joins on `user_id`, never on `account_members.id`

`interactions.actor_member_id` [Source: supabase/schemas/01_tables.sql:454] points at
`account_members.id` — the **membership row**, not the person. Membership rows are not stable
across a persona round-trip: `remove_persona()` archives
[Source: supabase/schemas/02_functions.sql:770] and `add_persona()` inserts a fresh row
[Source: supabase/schemas/02_functions.sql:531], and
`account_members_account_user_active_uq` is **partial** — `(account_id, user_id) where status =
'active'` [Source: supabase/schemas/01_tables.sql:710] — so the archived and the new active row
coexist with different `id`s. 3.5's `current_member_id()` resolves the *active* row, so
`actor_member_id = public.current_member_id()` is permanently false for every note the person
wrote before the round-trip: their own notes become uneditable and, in a `self_manager`
household with no second owner, unrecoverable by anyone.

`can_moderate_note()` therefore joins `account_members` on `id = p_actor_member_id` and compares
`am.user_id = auth.uid()`. `user_id` survives archival — the row is only ever status-flipped,
and the FK is `on delete set null`
[Source: supabase/schemas/01_tables.sql:592], not `on delete cascade`. AC 4(e) is the test that
fails if this is implemented the other way.

Note the consequence, and accept it: this story does **not** consume `current_member_id()`
directly. Its dependency on 3.5 is via `set_interaction_actor_member_id`, which is what
populates `actor_member_id` in the first place.

### Why one predicate function instead of duplicating it in the view

AC 3's policy and AC 5's view need the identical answer to "may this caller edit this row". Two
copies of the predicate is exactly the divergence the spine forbids —
*"normalization, visibility, suggestion-creation, state-transition, entitlement each in **one**
Postgres function/trigger"*
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:190]
— and it is the same reasoning that produced `is_owning_membership_role()` itself
[Source: supabase/schemas/02_functions.sql:434-438]. `can_moderate_note()` is `SECURITY
DEFINER` for the reason `current_context_id()` states in its own comment
[Source: supabase/schemas/02_functions.sql:199-200]: it is called from an RLS policy and must
not recurse into `account_members`' own SELECT policy. It returns a boolean and no data, so the
definer rights leak nothing.

### Why the split, and why the author clause sits in `using`

Two failure modes make AC 4 pass for the wrong reason:

(a) **A second permissive UPDATE policy.** Permissive policies OR per command, so a "narrower"
second policy widens access. `account_members` carries this warning in writing
[Source: supabase/schemas/05_policies.sql:124-127]: *"Do NOT add a `for select` policy alongside
a `for all` one to 'restore' this shape — permissive policies OR together."*

(b) **The author clause only in `with check`.** A helper updating another member's note would
then get a policy **error** rather than the zero-rows outcome AC 4 asserts, and the row is still
targetable. Both `using` and `with check` carry it.

DELETE deliberately gets no policy: `authenticated` holds no DELETE grant
[Source: supabase/schemas/06_grants.sql:596-597], so a policy would be inert text that reads
like a capability.

### Cross-reference for Story 6.4

`6-4` instructs adding `and kind <> 'single_input'` to the `with check` of **every other**
policy on `interactions`, enumerated via `pg_policies`
[Source: _bmad-output/implementation-artifacts/6-4-the-singles-input.md:137-144] — and it
already anticipates this split ("plus 3.6's note-author clause if it landed as a separate
policy"). This story turns one policy into three, so 6.4's set grows from one to three. No
action here beyond leaving the policy names stable and predictable:
`"Interactions readable within account and parent visibility"`,
`"Interactions insertable within account and parent visibility"`,
`"Interactions updatable by author or owning role"`.

### Resolving the author's name

Settled — this is no longer an open decision. `account_members.user_id` references
`auth.users(id)` [Source: supabase/schemas/01_tables.sql:592]; `public.members` (the table Epic 1
renamed from `sales`) carries `user_id uuid not null`
[Source: supabase/schemas/01_tables.sql:20] under the unique index `uq__members__user_id`
[Source: supabase/schemas/01_tables.sql:25]. The join is
`account_members.user_id = members.user_id`, done once in the view.

Under `security_invoker`, `members`' own SELECT policy applies
[Source: supabase/schemas/05_policies.sql:18-29]: a caller reads their own row plus any member
sharing an **active** membership of the caller's currently active context. An author who has
since left the household therefore yields `author_name = null` through the LEFT JOIN — not an
error, and not a leak. The UI renders a translated fallback label; AC 5's fourth check pins
the behaviour.

### Migration hygiene

`02_functions.sql` must be in exact `pg_dump` form — `CREATE OR REPLACE FUNCTION
"public"."name"(…) … LANGUAGE "sql"`, quoted identifiers, as at
[Source: supabase/schemas/02_functions.sql:439-444] — or `supabase db diff` emits a phantom
diff. Schema file → `db diff` → hand-check → `migration up --local`. Never `db push` from a
story; never `db reset` outside the deliberate Task 4 rehearsal.

Every `npx supabase` invocation is prefixed with `DBUS_SESSION_BUS_ADDRESS=/dev/null` — without
it the CLI hangs on the keyring, which reads like a Docker fault and is not one.

### Testing standard

AAA; ≥80% coverage on new code [Source: .claude/rules/testing.md]. `app` project for
`NotesTab.test.tsx`, `db` project for the RLS suite
[Source: vitest.config.ts:112-121]. Browser-mode vitest only — `vitest-browser-react` with
`TestMemoryRouter` and `CoreAdminContext` from `ra-core`, in real Chromium
[Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,62-75].
**React Testing Library is not a dependency**: no `screen.queryByText`, no `MemoryRouter`. The
negative idiom is
`await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`.

Security review is required — this story rewrites an RLS policy, adds a `SECURITY DEFINER`
function and widens a column grant [Source: .claude/rules/security-triggers.md].

### Project Structure Notes

- `NotesTab.tsx` and `NotesTab.test.tsx` live in
  `src/components/atomic-crm/entity360/tabs/`, beside 3.5's `ActivityTab.tsx`,
  `interactionLabels.ts` and `types.ts`. That directory does not exist until 3.5 lands.
- No `useMyMemberId` hook is created. The previous revision of this story specified one
  returning the caller's `account_members.id`; that is precisely the value the archive/re-add
  mechanism invalidates. `can_moderate` on the view replaces it.

### What this story deliberately does not do

- No edit to `shidduchim/ShidduchTimeline.tsx` (Epic 5, Story 5.1 removes its `AddNote`).
- No un-delete UI (AC 1 explains why the grant permits it anyway).
- No `RecordLink` rendering (see "Position in Epic 3").
- No change to who may **read** or **insert** an interaction.
- No new `target_type` value, so `PENDING_DB_WIDENINGS`
  [Source: _bmad-output/planning-artifacts/epic3-api-contract.md — §8 rule 2] is untouched
  by this story.

### References

- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — §8 universal tab props,
  §11 Ruling 1, §12 build order, §13 test-shape rules
- [Source: _bmad-output/planning-artifacts/epics.md:525-536] — Story 3.6's epic-level AC
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:168-172]
  — UX-DR5: Notes appears in all four entity tab sets; `:186-187` UX-DR11 states
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-175]
  — AD-23 vocabulary (**single**, never "child"); `:177-180` AD-24; `:190` single-owner logic
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md] — the schema
  widening, `current_member_id()`, `set_interaction_actor_member_id`, `interactionLabels.ts`
  and `UniversalTabProps` this story builds on
- [Source: supabase/schemas/01_tables.sql:432-478] — the `interactions` table, its three check
  constraints and the AD-3 discriminator comment; `:454` `actor_member_id`; `:710` the partial
  unique index; `:592`, `:20`, `:25` the author join keys; `:729` `interactions_target_idx`
  `(account_id, target_type, target_id, created_at desc)`, which AC 6's filter+sort matches exactly — no new index is needed
- [Source: supabase/schemas/02_functions.sql:439-444] — `is_owning_membership_role`;
  `:434-438` its "can never diverge" rationale; `:199-201` `current_context_id`'s
  SECURITY DEFINER rationale; `:531`, `:770` the persona insert/archive pair
- [Source: supabase/schemas/03_views.sql:101,170] — the `security_invoker` summary-view template
- [Source: supabase/schemas/04_triggers.sql:180-182] — `validate_interactions_household_scope`,
  dropped by Story 3-14
- [Source: supabase/schemas/05_policies.sql:262-315] — the `for all` policy being split;
  `:113-142` the OR-widening warning; `:143-156` the per-command-split precedent; `:18-29` the
  `members` read policy that governs `author_name`
- [Source: supabase/schemas/06_grants.sql:412-422,595-597] — the withheld DELETE grant;
  `:611-616` the column-scoped UPDATE grant this story widens; `:291-293`, `:442-444` the
  function- and view-grant templates
- [Source: src/components/atomic-crm/shidduchim/ShidduchTimeline.tsx:13-17,35-90,61-66] —
  `formatTimelineDate`, the `AddNote` implementation this tab generalises, and the `useNotify`
  error pattern
- [Source: src/components/atomic-crm/providers/fakerest/internal/supabaseAdapter.ts:4-8,18-20],
  [Source: src/components/atomic-crm/providers/fakerest/dataProvider.ts:211-216,388-399],
  [Source: src/components/atomic-crm/providers/fakerest/internal/accountMemberships.ts:24-37] —
  the AD-10 FakeRest mirror pattern
- [Source: .claude/rules/security-triggers.md, .claude/rules/testing.md,
  .claude/rules/english-only.md, .claude/rules/coding-style.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), dispatched as the harness `developer` role
via the `bmad-dev-story` skill.

### Debug Log References

- `deleted_at` was already present on `public.interactions` (3.5's column, per contract §10) —
  confirmed via `01_tables.sql` before touching anything, per the story's explicit instruction to
  stop and report rather than add it if missing. It was present, so Task 1's `ALTER TABLE` step
  was a no-op.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
  add_interaction_soft_delete_and_note_authorship` produced the `DROP POLICY` + three
  `CREATE POLICY` + `CREATE FUNCTION can_moderate_note` + `CREATE OR REPLACE VIEW
  interactions_summary` — but **zero** grant/revoke statements and **no** `WITH (security_invoker
  = on)` on the new view. Both are documented, pre-existing `db diff` gaps in this exact repo
  (see `supabase/migrations/20260724112600_add_summary_stats_views.sql`'s own "MANUAL
  ADJUSTMENTS" comment for the identical `security_invoker` drop; the missing grants are the same
  class of gap, extended here to also cover a brand-new `SECURITY DEFINER` function and a
  column-privilege widening in the same pass). Added by hand, in the same style/comment as that
  precedent migration, then verified live: `alter view ... set (security_invoker = on)` was
  proven load-bearing, not cosmetic — running the DB suite once *without* it reproduced two real
  failures (AC 5(i)'s `reloptions` check, and AC 5(iv)'s archived-author check leaking "Devora
  Fisch" straight through, because the view executed as its **owner**, bypassing `members`' own
  RLS entirely). Fixed, then `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db reset --local`
  (to apply the corrected migration from a clean state) followed by
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local` → "No schema changes found".
- AC 4(h) as literally tabled ("in a shadchanus context, insert `kind='note'`,
  `target_type='shadchan'`, `scope='account'`") is **unsatisfiable** under the current schema, not
  merely untested: `shadchanim` remains one of the 11 household-only tables 3-14 left untouched
  (`validate_shadchanim_household_scope`, `04_triggers.sql`, still fires unconditionally on
  insert), so no `public.shadchanim` row can ever have `account_id` equal to a shadchanus
  account. The account-scope branch for `target_type = 'shadchan'` requires
  `exists (select 1 from shadchanim where account_id = current_context_id())`, which can
  therefore never hold while genuinely active in a shadchanus context. 3-14's own suite
  (`household_scope_lift.sql` AC 4(b)) hit the identical wall and used `target_type = 'reference'`
  instead — the one shape whose account-scope branch carries no existence check at all — for this
  exact "does an interactions insert succeed while active in a shadchanus context" proof.
  Implemented check (h) the same way, fully documented in `interaction_note_authorship.sql`'s
  header and inline at that check, and flagged below as a likely contract defect rather than
  silently "fixed".
- `npm run test:unit:db` (default local stack): 10 files / 390 passed, 1 pre-existing skip — no
  regressions from the policy split or the new view.
- `make test STACK_ID=2` (full suite, all projects, isolated e2e stack, then released): 136 files
  / 1409 tests passed, 1 pre-existing skip. `npm run typecheck`, `npm run lint`,
  `npx prettier --check` (scoped to files this story owns — the repo-wide check also lists
  pre-existing, unrelated `.mdx`/workflow formatting drift this story did not introduce) and
  `npm run build` all clean.
- Security review (security-review skill) performed on the full diff — RLS policy rewrite, new
  `SECURITY DEFINER` function, widened column grant. See Completion Notes for the outcome.

### Completion Notes List

- All 7 tasks and all 9 ACs implemented and verified; see the gate output above and in the final
  handoff.
- `01_tables.sql` was **not** touched, per the story's explicit instruction: `deleted_at` was
  already present (3.5's column).
- `ActivityTab.tsx` / `ActivityTab.test.tsx` were **not** touched: 3.5 had already shipped the
  `"deleted_at@is": null` filter and its own falsifiable test case
  ("ActivityTab — deleted_at exclusion against the real FakeRest provider (AC 11)"). Verified by
  reading both files before deciding not to edit them, per the story's explicit "verify, don't
  re-add" instruction.
- `dataGenerator/references.ts` was granted but not edited: its interactions fixtures are
  `link_created`/`call_logged` rows, never `kind = 'note'`, so `NotesTab` never reads them and
  there was nothing for this story to stamp there. Their `actor_member_id: null` is the
  documented "legacy authorless data" case (Task 3's third bullet), left as-is.
- **Contract defect to report**: AC 4(h)'s literal `target_type = 'shadchan'` shape cannot pass
  while genuinely active in a shadchanus context, for the structural reason in the Debug Log
  above. Implemented against `target_type = 'reference'` instead, preserving the check's real
  intent (proving 3-14's interactions-trigger drop, plus this story's own split policies, work
  for a `kind = 'note'` insert/read in a shadchanus context) — the one target_type whose
  account-scope branch has no existence-check gate, and the exact shape 3-14's own suite already
  uses for this identical proof. This is a genuine schema-level constraint, not a testing
  shortcut: `target_type = 'single'` has the identical problem (`singles` is also household-only),
  so no different literal target_type would have closed this gap either.
- `can_moderate_note()`'s two review-blocking traps (never `am.role = 'parent_admin'`, never
  `actor_member_id = current_member_id()`) are both implemented per the story's exact `pg_dump`
  text and independently proven by checks (d) and (e) of the db suite.
- The FakeRest mirror's `resolveContextMembership` (new, in `accountMemberships.ts`) and
  `resolveCallerMembership` (new closure in `dataProvider.ts`) are the emulation counterpart of
  `current_member_id()`; `isOwningMembershipRole` is a small, local, one-line predicate in
  `dataProvider.ts` rather than imported from `providers/commons/roleAuthority.ts` — that file is
  outside this story's owned-paths list, and the predicate is two string comparisons, not worth a
  cross-story dependency.
- `registry.json` picked up exactly one addition (`NotesTab.tsx`) from `make registry-gen`; no
  other entries changed.
- Security review: no findings. Checked specifically for (1) the split-policy OR-widening hazard
  (confirmed absent — the `for all` policy is fully replaced, not supplemented); (2) the
  `can_moderate_note()` author branch being spoofable (confirmed not — `actor_member_id` is
  server-set by 3.5's trigger and the client never supplies it in `NotesTab`); (3) the widened
  `deleted_at` grant being exploitable beyond "an author can un-delete their own note", which AC 1
  already accepts explicitly; (4) `interactions_summary`'s `security_invoker` actually applying
  (see the Debug Log's account of catching this live, pre-fix); (5) `NotesTab.tsx` never sending
  `actor_member_id` in its `create`/`update` payloads (asserted in `NotesTab.test.tsx`).
- Nothing in the contract was found wrong beyond the AC 4(h) shape noted above.

### Review Fix Notes (post-review round 1, commit `0a4972f` → this commit)

Quality review returned NEEDS-FIX (3 blocking, 6 should-fix). Disposition below; every
blocking finding fixed, every should-fix fixed except S4 (ratified, not code) and S5
(documented, not code — no functional defect).

- **B1 (blocking) — fixed.** This story's policy rename silently broke 3.5's
  `interactions_targets.sql` suite (it dropped/recreated a policy by the pre-3.6 name that no
  longer exists, aborting under `ON_ERROR_STOP` and reporting as a `bailIfDbUnreachable` skip
  rather than a failure). That file is **outside this story's owned-paths list**
  (`interactions_targets.sql` belongs to 3.5) — fixed anyway, as a direct, necessary consequence
  of this story's own policy split, rather than left broken because of a path-ownership
  technicality; flagged here for the record rather than silently expanded in scope. The fix
  narrows the swap-and-restore technique that file uses to isolate AC 3's contribution so it
  targets the renamed INSERT policy (`"Interactions insertable within account and parent
  visibility"`) specifically, instead of a single combined `for all` policy that no longer
  exists; the SELECT policy the same technique used to also swap is left untouched throughout,
  since Story 3.6 preserved it byte-identical and it was never the thing under test. Verified:
  `interactions_targets.sql` runs 27/27 again (was 0/27, silently reported as "1 skipped").
- **B2 (blocking) — fixed.** Added the `pg_policies` catalog check AC 2 mandates
  (`interaction_note_authorship.sql`, position-independent, alongside AC 5(i)): asserts
  `array_agg(cmd order by cmd)` for `public.interactions` equals exactly
  `{INSERT,SELECT,UPDATE}`. Falsifiable against the exact hazards AC 2 names (a `for all`
  remnant, a fourth policy, a stray `for delete` policy) — none of which the previous suite could
  catch.
- **B3 (blocking) — fixed.** Added the two denial checks AC 1 mandates: `set target_id = 999` on
  an owned note, and `delete` on an owned note, both while RLS itself is satisfied (still the
  author, still their active context) so the denial is column/table-privilege, not policy. Both
  assert `sqlstate = '42501'` rather than message text — live Postgres raises `permission denied
  for table interactions` for the `target_id` case, not AC 1's literal "permission denied for
  column" (a table-level ACL check short-circuits before a column-specific message forms); this
  divergence is now documented inline rather than silently mismatched against the AC's literal
  wording.
- **S1 (should-fix) — agreed, fixed.** Verified the review's claim by hand: replacing the UPDATE
  policy's entire `using` visibility predicate with `true` still leaves all checks green, because
  Postgres applies the SELECT policy to the row-read half of an `UPDATE … WHERE` — a row hidden
  from SELECT never reaches the UPDATE policy's own `using` at all. Check (f)'s comment claiming
  it "proves the preserved account-scope `using` clause" was therefore false; by construction it
  can never be provable, since 05_policies.sql keeps that conjunct byte-identical between SELECT
  and UPDATE. Corrected the header falsifiability record and the inline comment at (f) to state
  what it actually is (a SELECT-side regression guard, exercised via an OWNING-role login) and to
  point at (b) as the check that actually isolates the author-or-owning-role clause living in
  `using` rather than `with check` alone.
- **S2 (should-fix) — agreed, fixed.** Check (b)'s `DO` block now has an `exception when others`
  handler (mirroring (h)'s existing pattern), so the "author clause in `with check` only" mutation
  reports (b) as RED with the raised error as detail, instead of aborting the whole script under
  `ON_ERROR_STOP` and degrading the suite to a skip.
- **S3 (should-fix) — agreed, fixed.** `interactions_summary.can_moderate` now computes
  `kind <> 'note' or can_moderate_note(actor_member_id)` — the UPDATE policy's full predicate —
  instead of calling `can_moderate_note()` unconditionally. A row the view returns has already
  passed the (byte-identical) SELECT visibility predicate, so for `kind <> 'note'` the UPDATE
  policy already lets any account member update it; `can_moderate` now says so. Added a check
  proving it (helper1 reads `can_moderate = true` on parent_admin's `call_logged` row, the exact
  shape check (g) already proved the UPDATE policy allows). Mirrored the identical fix in the
  FakeRest `enrichInteractions()` (AD-10) — it had the same unconditional-`can_moderate_note()`
  shape. Harmless in practice today (`NotesTab` only ever reads `kind = 'note'` rows through this
  view/enricher), but AC 8's own written trigger for revisiting names `ActivityTab` moving onto
  this view as the first consumer that would have observed the wrong answer.
- **S4 (should-fix) — agreed the deviation is real; ratified here rather than left open.** AC
  4(h)'s substitution of `target_type = 'reference'` for the literally-tabled `'shadchan'` is
  accepted as correct, not merely "likely" — it mirrors 3-14's own suite
  (`household_scope_lift.sql` AC 4(b)) verbatim for the identical proof shape, and no other
  `target_type` closes the gap either (`single` has the same household-only-table problem). The
  substitution changes what (h) proves only cosmetically: it still proves a `kind = 'note'`
  insert+read succeeds while genuinely active in a shadchanus context, which is 4(h)'s real
  intent. No AC or story text is rewritten by this fix (a settled AC is not this pass's to
  rewrite unilaterally) — this note is the formal acknowledgment the review asked for.
- **S5 (should-fix) — agreed the gap is real; documented, not coded.** No behavior change: the
  existing `can_moderate_note(NULL)` semantics (false on the author branch, owning-role-only
  otherwise) are the correct, safe default for a note with no recorded author, not a bug. What
  was missing was visibility — the acknowledgment lived only in a FakeRest code comment. Now
  stated here directly: any real `interactions` row with `kind = 'note'` and `actor_member_id
  is null` written before 3.5's `set_interaction_actor_member_id` trigger landed becomes
  moderatable only by an owning-role member of the account it belongs to, and — in a
  **shadchanus** context specifically, where no membership role is "owning"
  (`is_owning_membership_role()` only recognizes `parent_admin`/`self_manager`, both
  household-only roles) — such a note becomes unmoderatable by anyone until 3-14/Epic-6 give
  shadchanim their own owning-role shape. No backfill was run and none is planned in this story:
  the data needed to attribute those notes to a real author was never captured, so there is
  nothing truthful to backfill. Reads are unaffected. Flagged here as a deploy-notes-worthy fact
  for whoever owns the shadchanim role model next, not a defect in this story's own scope.
- **S6 (should-fix) — agreed, fixed.** `6-3-field-level-scoping-for-a-single.md` still named the
  pre-split `"Interactions scoped to account and parent visibility"` policy as its base; updated
  to name the three post-3.6 policies, mirroring the cross-reference this story's own Dev Notes
  already gave 6-4.
- Full gate re-run after all of the above: see the top-level fix commit's own verification
  output (`npm run typecheck`, `npm run lint`, `make test STACK_ID=2`, `npm run test:unit:db`).

### File List

**Modified:**
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/03_views.sql`
- `supabase/schemas/05_policies.sql`
- `supabase/schemas/06_grants.sql`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/internal/accountMemberships.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `registry.json` (auto-generated by `make registry-gen`)

**Added:**
- `supabase/migrations/20260729042335_add_interaction_soft_delete_and_note_authorship.sql`
- `supabase/tests/interaction_note_authorship.sql`
- `supabase/tests/interaction_note_authorship.test.ts`
- `src/components/atomic-crm/entity360/tabs/NotesTab.tsx`
- `src/components/atomic-crm/entity360/tabs/NotesTab.test.tsx`

**Verified, not edited (in-scope, already satisfied by 3.5):**
- `supabase/schemas/01_tables.sql` (`deleted_at` already present)
- `src/components/atomic-crm/entity360/tabs/ActivityTab.tsx` (filter already present)
- `src/components/atomic-crm/entity360/tabs/ActivityTab.test.tsx` (test case already present)

**Granted but not needed:**
- `src/components/atomic-crm/providers/fakerest/dataGenerator/references.ts` (no `kind = 'note'`
  rows exist there — see Completion Notes)

**Modified in the review-fix pass (outside this story's owned-paths list — see Review Fix Notes,
B1 and S6):**
- `supabase/tests/interactions_targets.sql` (3.5's suite — B1: repointed its transient
  policy-swap technique from the pre-3.6 combined `for all` policy name, which this story's own
  split removed, to the renamed INSERT policy)
- `_bmad-output/implementation-artifacts/6-3-field-level-scoping-for-a-single.md` (S6 — doc-only
  cross-reference update to the post-split policy names)

## Change Log

| Date | Change |
|---|---|
| 2026-07-29 | Story implemented end-to-end: `can_moderate_note()` (AC 3), the `for all` interactions policy split into three per-command policies with the author-or-owning-role clause on UPDATE only (AC 2/3), the widened `(body, metadata, deleted_at)` column grant (AC 1), `interactions_summary` with `security_invoker = on` (AC 5, including a live-caught `db diff` gap that dropped the option), the FakeRest AD-10 mirror (author_name/can_moderate enrichment + actor_member_id create-path stamping, AC 5/6), the `interaction_note_authorship` db suite (AC 4's eight checks + AC 5's four view checks, with check (h) adapted to a satisfiable target_type and the deviation documented and reported), `NotesTab.tsx` + `NotesTab.test.tsx` (AC 6/7/9), and the i18n catalog entries under `crm.entity360.notes.*` (English + French). `ActivityTab.tsx`/`.test.tsx` and `01_tables.sql` verified already satisfied by 3.5 and left untouched. Status → review. |
| 2026-07-29 | Review fix pass (post-NEEDS-FIX): fixed B1 (3.6's policy rename had silently zeroed out 3.5's `interactions_targets.sql` suite — repointed its policy swap at the renamed INSERT policy), B2 (added AC 2's missing `pg_policies` shape check), B3 (added AC 1's missing column/table permission-denial checks); fixed S1 (corrected a false claim in check (f)'s comment, re-pointed at check (b) as the real isolator), S2 (check (b) now degrades to RED, not a suite-aborting SKIP, under the with-check-only mutation), S3 (`interactions_summary.can_moderate` and its FakeRest mirror now honor the `kind <> 'note'` escape); ratified S4 (AC 4(h)'s target_type substitution, documented rather than re-litigated) and documented S5 (pre-3.5 authorless notes' moderation shape, a real but out-of-scope gap) without a code change. Status remains review pending re-review. |
