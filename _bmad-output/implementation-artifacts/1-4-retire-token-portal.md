# Story 1.4: Retire the token portal

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the child-portal token surface deleted outright — its React directory, its
database table, its RPC, its grants, policy and trigger, its provider methods and every
one of its tests,
so that there is exactly one way a **single** sees their own process (Epic 6: they log in
and open the same screens as the parent), not two.

> **READ THIS FIRST — SHARING IS NOT BEING DROPPED.** (This is the most misread part of
> this story.)
>
> This story deletes the **inbound, unauthenticated token portal** (E7). It does **not**
> touch the *outbound, revocable, expiring share link* for a single's profile/resume —
> **FR107 / CAP-12 is a live, retained requirement**, delivered by **Epic 9, Story 9.5**
> on the AD-21 listings/sharing model (a Worker-proxied, logged, expiring link), not by
> resurrecting `child_portal_tokens`.
>
> Sharing is not being dropped; it is being moved to where it belongs. **Do not build any
> part of it here, and do not preserve any part of the E7 table "so Epic 9 can reuse it" —
> AD-21 does not use it.** AC 12 forbids the keep-it-just-in-case reflex; AC 14 requires
> this carry-forward to be written into the Dev Agent Record so the next reader of the git
> history cannot misread the deletion as a scope cut.

**Position in Epic 1 — this story is 2nd of 6.** The Epic 1 order is **binding**:
**1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**.

- **Depends on: 1.1** (fossil-resource deletion) having landed. 1.1 owns the fork `to anon`
  grants and the fossil tables; this story owns only the portal's own objects.
- **Blocks: 1.3** (`children` → `singles`). This is a **hard dependency, not a preference** —
  see AC 7 row 6 and "Sequencing — binding" in Dev Notes. `child_portal_tokens` carries a
  composite FK onto `public.children(account_id, id)`; it must be gone before the rename
  runs, so 1.3's migration never has to carry the portal's dependency through.
- Every `child`-named **symbol** — SQL `is_child_visible_state`, its TypeScript twin
  `isChildVisibleState`, `CHILD_VISIBLE_STATES` — is **1.3's** to rename, not this story's.
  See AC 8.

**Why this is a deletion and not a migration.** CAP-9 says the single "opens the same
screens as the parent with **no parallel interface**", and FR90 restates it. The E7 token
portal *is* a parallel interface: a second, unauthenticated, read-only rendering of the
same data, with its own shell, its own status vocabulary, its own scoping logic
(`get_child_portal()`) duplicating what RLS will own in Epic 6, and its own FakeRest
mirror. Under NFR-14 ("when something is replaced the replaced thing is deleted in the
same change") it goes now, before Epic 6 builds the real thing, so Epic 6 never has to
keep two code paths in step.

## Acceptance Criteria

1. **The portal directory is gone.** `src/components/atomic-crm/portal/` no longer exists —
   all 8 source files (`ChildPortalPage.tsx`, `ChildPortalPage.test.tsx`,
   `PortalSuggestionCard.tsx`, `childPortalStatus.ts`, `index.ts`, `portalClient.ts`,
   `portalToken.ts`, `portalToken.test.ts`) and the `__screenshots__/ChildPortalPage.test.tsx/`
   directory with its 5 committed PNG baselines are deleted. No file in `src/` imports from
   `../portal` or `@/components/atomic-crm/portal`.

2. **The `/portal` route is gone from the app entry.** `src/App.tsx` no longer imports
   `ChildPortalPage` or `isPortalUrl` and no longer branches on the URL: `App` renders
   `<LandingGate><CRM disableTelemetry /></LandingGate>` unconditionally. The JSDoc
   paragraph describing `/portal` (lines 7–10) is removed with it. No route, rewrite or
   redirect for `/portal` survives anywhere — `vercel.json`'s single catch-all rewrite
   (`/(.*) → /index.html`) is unchanged and is *not* to be given a `/portal` special case.

3. **The parent-side share surface is gone.**
   `src/components/atomic-crm/children/ChildPortalShare.tsx` (175 lines) is deleted, and
   `src/components/atomic-crm/children/ChildShow.tsx` no longer imports it (line 12) or
   renders it (line 113). `ChildShowLayout` renders `ChildProfileHeader` +
   `PipelineSnapshot` only, and the now-unused `childName` local is removed with it.

4. **Both data providers lose the four portal methods.** `getChildPortal`,
   `getActiveChildPortalToken`, `mintChildPortalToken` and `revokeChildPortalToken` are
   removed from `providers/supabase/dataProvider.ts` (lines 391–431) **and** from
   `providers/fakerest/dataProvider.ts` (lines 845–858), together with their imports
   (`supabase`: type imports at lines 13–14 and `loadChildPortal` at line 36; `fakerest`:
   type imports at lines 15–16 and the whole `from "./internal/childPortal"` block at
   lines 67–72). `providers/fakerest/internal/childPortal.ts` (137 lines) is deleted.

5. **The portal types are gone.** `ChildPortalToken`, `ChildPortalSuggestion` and
   `ChildPortalData` — the whole `MyShadchan — Read-only child portal (E7)` block at
   `src/components/atomic-crm/types.ts` lines 301–342 — are deleted, and no file imports
   them.

6. **The FakeRest fixture slot is gone.** `child_portal_tokens` is removed from the
   `DataGeneratorDb`-shaped type (`providers/fakerest/dataGenerator/types.ts` line 53, plus
   the `ChildPortalToken` import on line 5) and from the generator
   (`providers/fakerest/dataGenerator/index.ts` lines 70–72). Demo mode boots with no
   portal collection.

7. **All 13 database objects are dropped by one generated migration**, with
   `supabase/schemas/*.sql` edited first as the source of truth:

   | # | Object | Declared in |
   |---|---|---|
   | 1 | table `public.child_portal_tokens` | `01_tables.sql:638-645` |
   | 2 | identity sequence `public.child_portal_tokens_id_seq` | implicit (drops with the table) |
   | 3 | PK constraint/index `child_portal_tokens_pkey` | implicit |
   | 4 | unique constraint + index `child_portal_tokens_token_key` | `01_tables.sql:780-781` |
   | 5 | FK `child_portal_tokens_account_id_fkey` → `accounts(id)` | `01_tables.sql:782-783` |
   | 6 | FK `child_portal_tokens_child_id_fkey` → `children(account_id, id)` | `01_tables.sql:784-786` |
   | 7 | index `child_portal_tokens_account_id_idx` | `01_tables.sql:822` |
   | 8 | index `child_portal_tokens_child_id_idx` | `01_tables.sql:823` |
   | 9 | RLS policy `"Child portal tokens scoped to account"` | `05_policies.sql:292-295` |
   | 10 | trigger `set_child_portal_token_defaults` on the table | `04_triggers.sql:184-186` |
   | 11 | function `public.set_child_portal_token_defaults()` | `02_functions.sql:2158-2169` |
   | 12 | function `public.get_child_portal(text)` | `02_functions.sql:2187-2245` |
   | 13 | the `grant execute ... to anon` on `get_child_portal(text)` — the only `anon` grant in the shidduchim domain | `06_grants.sql:653` |

   Row 6 is the **hard ordering dependency**: `child_portal_tokens_child_id_fkey` is a
   *composite* FK `foreign key (account_id, child_id) references public.children(account_id, id)`
   (`01_tables.sql:784-786`). It reads `children` because this story runs **before** 1.3
   (2nd of 6 in the binding order). Do **not** write the edit defensively for a `singles`
   target — if `01_tables.sql` says `public.singles(account_id, id)` when you open it, the
   order has been violated: stop and report it rather than adapting.

   The five schema blocks removed are: `01_tables.sql` 623–645 (comment + table), 776–786
   (FKs), 822–823 (indexes); `02_functions.sql` 2144–2245 (the whole `Read-only child
   portal (E7)` section); `04_triggers.sql` 182–186; `05_policies.sql` 281–295;
   `06_grants.sql` 619–655.

8. **These objects survive this story untouched — because they are 1.3's to rename next,
   not because they are frozen.** They belong to AD-3 and are consumed by Epic 6, not by
   the portal. This story neither deletes nor renames them; it must not "clean them up",
   and it must not treat them as permanently fixed either:
   - **SQL** `public.is_child_visible_state(public.pipeline_state)` (`02_functions.sql:578`)
     and its three grant lines (`06_grants.sql:303-305`) — **left for story 1.3 to rename**
     to `is_single_visible_state` (1.3 AC-4, Task 2). Untouched here.
   - **TypeScript twin** `isChildVisibleState` and `CHILD_VISIBLE_STATES` in
     `src/components/atomic-crm/shidduchim/pipelineStates.ts:111,142`, plus their coverage in
     `pipelineStates.test.ts:5,107-116` — also **left for story 1.3 to rename**
     (`isSingleVisibleState` / `SINGLE_VISIBLE_STATES`). Under the binding ownership ruling,
     1.3 owns **every** `child`-named symbol including camelCase and SCREAMING_SNAKE
     compounds; this story renames none of them.
   - After this story both have **zero non-test callers**: deleting
     `providers/fakerest/internal/childPortal.ts` (AC 4) removes the TS twin's only
     production caller (`childPortal.ts:10,121` — verified as the sole import outside
     `pipelineStates.test.ts`), and deleting `get_child_portal(text)` (AC 7 row 12) removes
     the SQL function's only in-schema caller (`02_functions.sql:2234`). **That is expected
     and correct** — it is a two-story window, not dead code to delete: 1.3 renames both, and
     Epic 6's RLS is the caller that puts them back to work. Do not delete them, do not add a
     temporary caller, do not `eslint-disable` around them.
   - `shidduchim.owner_member_id` and `shidduchim.visibility` (`01_tables.sql:364-368`).
   - The historical migration `supabase/migrations/20260724170639_add_child_portal.sql` — it
     is *never* edited or deleted; the new migration drops what it created.

9. **All portal tests are deleted, none are skipped or quarantined.** Removed:
   `supabase/tests/child_portal.sql` (290 lines, 21 `insert into results` checks),
   `supabase/tests/child_portal.test.ts` (93 lines),
   `src/components/atomic-crm/providers/fakerest/dataProvider.childPortal.test.ts`
   (119 lines, 5 cases), plus the 2 test files inside `portal/` covered by AC 1
   (`ChildPortalPage.test.tsx` 5 cases, `portalToken.test.ts` 8 cases). No `it.skip`,
   `test.fixme`, `describe.skip`, `@ts-ignore` or `eslint-disable` is introduced anywhere
   by this change.

10. **Verification — no reference to the retired surface survives.** All of the following
    return **zero** hits:
    ```bash
    grep -rniE "child_portal|childportal|get_child_portal|portalToken|portalClient|PortalSuggestionCard|isPortalUrl|buildPortalUrl|readPortalToken|PORTAL_PATH" \
      src/ supabase/schemas/ supabase/tests/ e2e/ workers/ scripts/ public/
    ```
    (baseline re-verified on `main` at story-fix time: **247 hits across 25 files**)

    The `-i` flag is load-bearing: it is what makes `childportal` match the camelCase
    compounds `childPortal`, `ChildPortalPage`, `ChildPortalShare`, `loadChildPortal` and
    `dataProvider.childPortal.test.ts`. Do **not** replace it with `\bchild_portal\b` —
    word-boundary patterns silently miss every camelCase form. Conversely, this sweep
    deliberately does **not** carry a bare `[A-Za-z]Child|Child[A-Za-z]` pattern: that is
    story 1.3's guard, and running it here would (correctly) fire on `isChildVisibleState` /
    `CHILD_VISIBLE_STATES`, which AC 8 leaves standing for 1.3.
    ```bash
    ls src/components/atomic-crm/portal 2>/dev/null            # must not exist
    grep -rn "child_portal" supabase/schemas/                   # 0
    ```
    The only surviving occurrences of these strings in the repo are (a)
    `supabase/migrations/20260724170639_add_child_portal.sql`, the immutable historical
    migration, and (b) the planning documents under `_bmad-output/` and
    `design-artifacts/`, which are contract, not code.

11. **Verification — the database objects are actually gone.** Against the local stack, all
    four queries return `0`:
    ```sql
    select count(*) from pg_class where relname like 'child_portal%';
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_child_portal','set_child_portal_token_defaults');
    select count(*) from pg_policies where tablename = 'child_portal_tokens';
    select count(*) from pg_trigger where tgname = 'set_child_portal_token_defaults';
    ```
    and `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname = 'get_child_portal';` returns `0`. Paste the outputs into the Dev Agent
    Record.

12. **Nothing is left behind as a shim.** No compatibility alias, no `get_child_portal`
    stub returning `null`, no view named for the dropped table, no `/portal` redirect to the
    child list, no deprecated-but-kept provider method, no commented-out block "for Epic 9",
    and — most tempting, most wrong — **no part of `child_portal_tokens` retained "because
    Epic 9 needs share links". It does not: Story 9.5 builds on AD-21's listings snapshot,
    not on this table.** The deletion is total, in one change (NFR-14).

13. **Green baseline.** `npm run typecheck`, `npm run lint` (eslint), `make test`
    (app + functions + workers) and `npm run test:unit:db` all pass **repo-wide**, with no
    new warnings and no suppressions. The db suite must show `references_entity`,
    `shidduch_catch` and `billing_entitlement` still green and no `child portal (database)`
    suite present.

    **Formatting is scoped to this story's own diff:**
    `npx prettier --config ./.prettierrc.json --check <every file this story modifies>` returns
    clean. Repo-wide `npm run prettier` is **not** achievable here and is **story 1.6's** AC-5 —
    it fails on **89 files** on `main` (plus `mockup/MyShadchan.dc.html`, which prettier cannot
    parse at all), and this story, being almost pure deletion, touches barely any of them.

    `make test-e2e-ci` is also outside this gate: story 1.1 deleted the last Playwright spec and
    1.6 lands the replacement, so Playwright exits 1 with `Error: No tests found` throughout
    this story (1.1 §"Known interim red: the `e2e-test` job").

14. **The two carry-forwards are written down, not left to be inferred.** The Completion
    Notes in the Dev Agent Record state, in one line each:
    (a) the revocable/expiring share link (**FR107 / CAP-12**) is **not dropped** — it is
    delivered by Epic 9 Story 9.5 under AD-21/AD-9, and no part of it was implemented here;
    (b) `is_child_visible_state`, `isChildVisibleState` and `CHILD_VISIBLE_STATES` were
    **deliberately left standing with zero non-test callers** and are story **1.3's** to
    rename (AC 8) — they are not an oversight and not dead code.

## Tasks / Subtasks

- [ ] **Task 1 — Unwire the two entry points first, so nothing renders the portal mid-change (AC: 2, 3)**
  - [ ] Edit `src/App.tsx`: drop the `portal` import (line 2), drop the `isPortalUrl` branch
        (lines 35–37), drop the `/portal` JSDoc paragraph (lines 7–10). Result: `App` returns
        `<LandingGate><CRM disableTelemetry /></LandingGate>` only.
  - [ ] Edit `src/components/atomic-crm/children/ChildShow.tsx`: drop the `ChildPortalShare`
        import (line 12), drop `<ChildPortalShare … />` (line 113), drop the now-unused
        `childName` local in `ChildShowLayout`.
  - [ ] Run `npm run typecheck` — expect errors only in files scheduled for deletion.

- [ ] **Task 2 — Delete the frontend surface (AC: 1, 3, 4)**
  - [ ] `rm -r src/components/atomic-crm/portal/` (8 source files + `__screenshots__/ChildPortalPage.test.tsx/` with 5 PNGs).
  - [ ] `rm src/components/atomic-crm/children/ChildPortalShare.tsx`.
  - [ ] `rm src/components/atomic-crm/providers/fakerest/internal/childPortal.ts`.
  - [ ] Use `LSP findReferences` on `ChildPortalPage`, `isPortalUrl`, `buildPortalUrl`,
        `loadChildPortal` and `ChildPortalShare` before/after to confirm no live call site is
        left (per `.claude/rules/lsp-usage.md` — do not use `grep` for TS symbol lookup; the
        text sweep in Task 8 is the separate, deliberate string check).

- [ ] **Task 3 — Strip the provider methods and types (AC: 4, 5, 6)**
  - [ ] `providers/supabase/dataProvider.ts`: remove the `ChildPortalData` / `ChildPortalToken`
        type imports (lines 13–14), the `loadChildPortal` import (line 36) and the four methods
        with their section comment (lines 391–431).
  - [ ] `providers/fakerest/dataProvider.ts`: remove the two type imports (lines 15–16), the
        `./internal/childPortal` import block (lines 67–72) and the four delegating methods with
        their comment (lines 845–858).
  - [ ] `types.ts`: delete lines 301–342 (`ChildPortalToken`, `ChildPortalSuggestion`,
        `ChildPortalData` and the section banner).
  - [ ] `providers/fakerest/dataGenerator/types.ts`: remove `ChildPortalToken` from the type
        import (line 5) and the `child_portal_tokens: ChildPortalToken[];` field (line 53).
  - [ ] `providers/fakerest/dataGenerator/index.ts`: remove lines 70–72 (`db.child_portal_tokens = []`
        and its two comment lines).
  - [ ] `npm run typecheck` must now be clean: `CrmDataProvider` is `ReturnType<typeof
        getDataProviderWithCustomMethods>` (`providers/supabase/dataProvider.ts:636`) and the
        FakeRest object is annotated `: CrmDataProvider` (`providers/fakerest/dataProvider.ts:491`),
        so removing a method on only one side is a compile error — that is the intended guard.

- [ ] **Task 4 — Edit the declarative schema (AC: 7, 8)**
  - [ ] `supabase/schemas/06_grants.sql`: delete the whole `Child portal (E7)` block, lines 619–655.
  - [ ] `supabase/schemas/05_policies.sql`: delete lines 281–295 (comment, `enable row level security`, policy).
  - [ ] `supabase/schemas/04_triggers.sql`: delete lines 182–186 (comment + trigger).
  - [ ] `supabase/schemas/02_functions.sql`: delete lines 2144–2245 — the banner and **both**
        functions. Do **not** touch `is_child_visible_state` at line 578 — it keeps its
        `child` name until story 1.3 renames it (AC 8).
  - [ ] `supabase/schemas/01_tables.sql`: delete lines 623–645 (comment + `create table`),
        776–786 (the three constraint statements) and 822–823 (the two indexes). Do **not**
        touch the `visibility` / `owner_member_id` columns at lines 364–368. Confirm before
        editing that line 786 reads `references public.children(account_id, id)` — if it reads
        `public.singles`, 1.3 has landed out of order (see "Sequencing — binding"): stop.
  - [ ] Reword — do not delete — the 5 stale comments that promise a portal (listed in Dev
        Notes, "Stale comments"), so no comment in the repo still describes a surface that
        no longer exists. Reword the **prose only**: the identifiers inside those comments
        (`is_child_visible_state`, `CHILD_VISIBLE_STATES`) still read `child` after this story.

- [ ] **Task 5 — Generate and hand-check the migration (AC: 7, 11, 12)**
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f retire_child_portal`
  - [ ] Hand-check the generated SQL before applying. `db diff` is known in this repo to
        under-emit privilege statements (see the `HAND-FIXED (E7)` note at
        `supabase/migrations/20260724170639_add_child_portal.sql:113-120`) and to drop
        `security_invoker`. Confirm the migration contains, in this order:
        `drop trigger if exists set_child_portal_token_defaults on public.child_portal_tokens;`
        → `drop function if exists public.get_child_portal(text);`
        → `drop function if exists public.set_child_portal_token_defaults();`
        → `drop table if exists public.child_portal_tokens;`
        Add by hand anything `diff` omitted. The policy, indexes, constraints and the identity
        sequence drop with the table; the two `drop function` statements are the ones most
        likely to be missing or mis-ordered (the trigger depends on one of them). Do not add a
        `cascade` you did not verify the need for.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`
  - [ ] Never run `npx supabase db reset` or `npx supabase db push` in this story.
  - [ ] Run the catalog queries from AC 11 and record the output.

- [ ] **Task 6 — Delete the tests (AC: 9)**
  - [ ] `rm supabase/tests/child_portal.sql supabase/tests/child_portal.test.ts`.
  - [ ] `rm src/components/atomic-crm/providers/fakerest/dataProvider.childPortal.test.ts`.
  - [ ] Confirm no remaining suite imports from the deleted modules and that
        `supabase/tests/` still holds exactly 3 pairs (`billing_entitlement`,
        `references_entity`, `shidduch_catch`).

- [ ] **Task 7 — Seed / demo data (AC: 6)**
  - [ ] Boot demo mode (`npm run dev:demo`) and confirm it starts with no console error and
        that a child's Show page renders without the share panel. There is no SQL seed file to
        change: the only fixture surface was the FakeRest generator, handled in Task 3.

- [ ] **Task 8 — Verify and close (AC: 8, 10, 11, 13, 14)**
  - [ ] Run the AC 10 text sweep; it must return 0 hits (baseline 247 across 25 files).
  - [ ] `npm run typecheck && npm run lint && make test && npm run test:unit:db`, then
        `npx prettier --config ./.prettierrc.json --check` over **this story's changed files
        only** (AC 13 — repo-wide `npm run prettier` is 1.6's gate, not this one's).
  - [ ] Confirm the hand-off to 1.3 is intact, not accidentally cleaned up.
        `grep -rn "is_child_visible_state" supabase/schemas/` must still return the definition
        at `02_functions.sql:578` and the 3 grants at `06_grants.sql:303-305` (the two portal
        call sites at `02_functions.sql:2180,2234` are gone; the `05_policies.sql:186` mention
        is inside a reworded comment and may survive in either form). And
        `grep -rn "isChildVisibleState\|CHILD_VISIBLE_STATES" src/` must still return
        `shidduchim/pipelineStates.ts` and `pipelineStates.test.ts` — and, after AC 4, nothing
        else. **Zero hits on either grep means something was over-deleted: 1.3 renames these,
        this story does not remove them.**
  - [ ] Fill the Dev Agent Record: catalog-query outputs, **both** AC 14 lines (FR107 → Epic 9
        Story 9.5; visible-state symbols → story 1.3), and the File List.

## Dev Notes

### The verified surface (counted, not estimated)

Measured on `main` at the time of writing. `grep -rniE
"child_portal|childportal|get_child_portal|portalToken|portalClient|PortalSuggestionCard|isPortalUrl|buildPortalUrl|readPortalToken|PORTAL_PATH"`
over `src/ supabase/schemas/ supabase/tests/ e2e/ workers/` yields **247 hits in 25 files**.

**Deleted outright — 13 files (1,320 lines) + 5 PNG baselines + 2 directories.**
13 deleted + 12 edited = the 25 files the sweep hits:

| File | Lines | Hits |
|---|---|---|
| `src/components/atomic-crm/portal/ChildPortalPage.tsx` | 168 | 13 |
| `src/components/atomic-crm/portal/ChildPortalPage.test.tsx` | 109 | 10 |
| `src/components/atomic-crm/portal/PortalSuggestionCard.tsx` | 76 | 5 |
| `src/components/atomic-crm/portal/portalToken.ts` | 34 | 6 |
| `src/components/atomic-crm/portal/portalToken.test.ts` | 72 | 22 |
| `src/components/atomic-crm/portal/portalClient.ts` | 24 | 6 |
| `src/components/atomic-crm/portal/childPortalStatus.ts` | 20 | 5 |
| `src/components/atomic-crm/portal/index.ts` | 3 | 3 |
| `src/components/atomic-crm/portal/__screenshots__/ChildPortalPage.test.tsx/` | — | 5 PNGs |
| `src/components/atomic-crm/children/ChildPortalShare.tsx` | 175 | 12 |
| `src/components/atomic-crm/providers/fakerest/internal/childPortal.ts` | 137 | 21 |
| `src/components/atomic-crm/providers/fakerest/dataProvider.childPortal.test.ts` | 119 | 13 |
| `supabase/tests/child_portal.sql` | 290 | 41 |
| `supabase/tests/child_portal.test.ts` | 93 | 4 |

**Edited — 12 files:**

| File | Hits | What goes |
|---|---|---|
| `src/App.tsx` | 3 | import (l.2), JSDoc ¶ (l.7-10), `isPortalUrl` branch (l.35-37) |
| `src/components/atomic-crm/children/ChildShow.tsx` | 2 | import (l.12), render (l.113), unused `childName` |
| `src/components/atomic-crm/types.ts` | 7 | the 3 portal types, l.301-342 |
| `src/components/atomic-crm/providers/supabase/dataProvider.ts` | 17 | imports l.13-14, l.36; methods l.391-431 |
| `src/components/atomic-crm/providers/fakerest/dataProvider.ts` | 17 | imports l.15-16, l.67-72; methods l.845-858 |
| `src/components/atomic-crm/providers/fakerest/dataGenerator/types.ts` | 2 | import l.5, field l.53 |
| `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts` | 2 | l.70-72 |
| `supabase/schemas/01_tables.sql` | 11 | l.623-645, l.776-786, l.822-823 |
| `supabase/schemas/02_functions.sql` | 3 | l.2144-2245 |
| `supabase/schemas/04_triggers.sql` | 3 | l.182-186 |
| `supabase/schemas/05_policies.sql` | 3 | l.281-295 |
| `supabase/schemas/06_grants.sql` | 16 | l.619-655 |

**Not registered anywhere else.** Verified: `child_portal_tokens` is **not** a `<Resource>` —
`src/components/atomic-crm/root/CRM.tsx` and `src/components/atomic-crm/layout/navItems.ts`
contain zero portal references. There is no portal entry in `registry.json`, `vercel.json`,
`index.html`, `public/`, `workers/`, `scripts/`, `doc/`, `.github/` or the Playwright suites
(`e2e/` holds only `bulkContactTags.spec.ts`, `onboarding.spec.ts`, `userAddingATask.spec.ts`,
`fixtures.ts`). The word "portal" also appears in `src/components/admin/breadcrumb.tsx`,
`columns-button.tsx`, `ui/dialog.tsx`, `ui/drawer.tsx`, `ui/dropdown-menu.tsx` and
`ui/sheet.tsx` — those are React DOM portals (`createPortal`, Radix `<Portal>`) and are
**unrelated**; do not touch them.

### Stale comments to reword (5) — the code they annotate stays

These promise a portal that will no longer exist. Reword to point at Epic 6 (a single logs
in and sees the same screens, scoped by RLS); do **not** delete the code beneath them.

1. `supabase/schemas/01_tables.sql:364` — "columns locked NOW so the deferred child portal needs no breaking migration"
2. `supabase/schemas/02_functions.sql:577` — "the (deferred, Epic-9) portal view will call this"
3. `supabase/schemas/05_policies.sql:184-186` — "When the candidate portal and the `child` role land (Epic-9)…"
4. `src/components/atomic-crm/shidduchim/pipelineStates.ts:111` — "(The child portal itself is Epic-9; …)"
5. `src/components/atomic-crm/references/ReferenceCallLog.tsx:18` — "a future candidate portal derives what a child may see by joining…"

**Reword the prose only — do not rename the identifiers inside these comments.** Items 2, 3
and 4 sit next to `is_child_visible_state` / `isChildVisibleState` / `CHILD_VISIBLE_STATES`;
those names are **1.3's** to change (AC 8) and must still read `child…` when this story
finishes. The comment should stop promising a *portal* while continuing to name the symbol
exactly as the code does. Likewise, the word "child" as a **domain noun** ("a child may see")
is 1.3's vocabulary sweep, not this story's — retarget the Epic reference (Epic-9 portal →
Epic 6 login), leave the noun.

### Migration workflow (this repo's rules)

`supabase/schemas/*.sql` is the **source of truth**; `supabase/migrations/` is generated.
Edit the schema files first, then:

```bash
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f retire_child_portal
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local
```

The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is mandatory on **every** `npx supabase`
call in this environment — without it the CLI hangs on the D-Bus keyring and the failure
looks like a Docker fault but is not.

**Never** run `npx supabase db reset --local` (destroys local data) or `npx supabase db push`
(production). Production already has E7 deployed, so this drop migration will eventually run
against production — but pushing it is the deploy-time migration round owned by the
orchestrator, not this story.

**`db diff` needs hand-checking.** It historically drops `security_invoker = on` from views
and omits `REVOKE` statements; the E7 migration itself carries an explicit `HAND-FIXED (E7)`
comment for exactly that reason
(`supabase/migrations/20260724170639_add_child_portal.sql:113-120`). For a *drop* migration
the risk inverts: `diff` may emit the table drop but miss or mis-order the two
`drop function` statements, and the trigger must go before the function it executes. Read the
generated SQL line by line and fix it by hand where needed. Function bodies in
`02_functions.sql` must keep the exact `pg_dump` shape (`npx supabase db dump --local --schema
public`) or the next `db diff` produces phantom diffs — this story only *removes* functions, so
just make sure nothing around the deleted block is reformatted.

### RLS / security notes

This change touches RLS, grants and a `SECURITY DEFINER` function, so it is a
security-reviewer trigger under `.claude/rules/security-triggers.md`.

`get_child_portal(text)` is the **only** function in the shidduchim domain granted to `anon`
(`06_grants.sql:653`). Dropping it removes the product's last deliberate anonymous read path
until AD-21's `listings` snapshot arrives in Epic 9 — which is exactly AD-1's target state
("the **only** anon-readable relation in the product is the published-listing snapshot"). The
other `to anon` lines in `06_grants.sql` (lines 8–172) are fork fossils on
contacts/companies/deals/tags/sales/`init_state` plus the `alter default privileges … to anon`
grants; they are **Story 1.1's** scope, not this one — do not touch them here.

The usual "every RLS change needs a negative test" rule is satisfied here by *deleting* the
surface plus the AC 11 catalog assertions, which prove the objects and the anon grant are
gone. A permanent CI assertion that no `public` table lacks RLS and that `anon` holds no
grant anywhere is **AD-1 / Epic 2 (Story 2.1)** work — explicitly out of scope here, and
called out so it does not read as an omission.

### Testing standards

Per `.claude/rules/testing.md`: no `it.skip` / `test.fixme` / `describe.skip` may be
introduced. This story removes 39 assertions in total (21 SQL checks + 5 FakeRest cases + 5
`ChildPortalPage` cases + 8 `portalToken` cases) because the behaviour they cover ceases to
exist. That is a legitimate coverage *reduction* — it is not a coverage regression on retained
code, and no retained module loses a test. `pipelineStates.test.ts` keeps its
`isChildVisibleState` coverage untouched — 1.3 renames both the symbol and its assertions
afterwards (AC 8); do not pre-empt that here, and do not delete the test because its only
production caller went away.

Test commands: `make test` runs the `app`, `functions` and `workers` vitest projects;
the SQL suites are a separate project — run `npm run test:unit:db` explicitly (it needs
`make start`, and skips itself if the DB is unreachable, so confirm it actually ran).

### Project Structure Notes

- The portal lived **outside** the CRM shell by design (`App.tsx` checked `isPortalUrl` before
  mounting `<CRM>`), which is why removing it needs no react-admin `<Resource>`,
  `navItems.ts` or router change. After this story `src/App.tsx` has exactly one rendering
  path — consistent with UX-DR2 (one route convention) and CAP-9 (no parallel interface).
- Deleting `providers/fakerest/internal/childPortal.ts` keeps the supabase/fakerest provider
  pair in sync, which AD-10 requires. The type system enforces it: `CrmDataProvider` is derived
  from the supabase provider (`providers/supabase/dataProvider.ts:636`) and the FakeRest object
  is annotated with it (`providers/fakerest/dataProvider.ts:491`), so a one-sided removal fails
  `npm run typecheck`.
- `src/components/atomic-crm/portal/` disappearing takes the directory count in
  `atomic-crm/` down by one; nothing else in the tree is restructured. Per
  `.claude/rules/coding-style.md` this is pure deletion — do not "refactor while you're in
  there".

**Files other Epic 1 stories also touch.** In the binding order (1.1 → **1.4** → 1.5 → 1.3 →
1.2 → 1.6), 1.1 is **already landed** when this story runs and 1.5 / 1.3 / 1.2 / 1.6 all come
**after** it — so every line number quoted here is measured on a tree where 1.1's deletions
have been applied and nothing else has. Re-verify before editing; never carry another story's
edit into this one.

| File | Also touched by | Relative to this story |
|---|---|---|
| `src/components/atomic-crm/types.ts` | 1.1 (drop fork types), 1.3 (`Child`→`Single`), 1.2 (`Sale`→`Member`) | 1.1 before; 1.3, 1.2 after |
| `providers/supabase/dataProvider.ts` | 1.1, 1.5, 1.3, 1.2 | 1.1 before; rest after |
| `providers/fakerest/dataProvider.ts` | 1.1, 1.3, 1.2 | 1.1 before; rest after |
| `providers/fakerest/dataGenerator/{index,types}.ts` | 1.1, 1.3, 1.2 | 1.1 before; rest after |
| `src/components/atomic-crm/children/ChildShow.tsx` | 1.3 (renamed to `singles/SingleShow.tsx`) | after |
| `src/App.tsx` | 1.5 (dead routes / route manifest) | after — remove only the `isPortalUrl` branch |
| `supabase/schemas/01_tables.sql` | 1.1, 1.3, 1.2 | 1.1 before; rest after |
| `supabase/schemas/02_functions.sql` | 1.1, 1.3, 1.2 | 1.1 before; rest after |
| `supabase/schemas/05_policies.sql`, `06_grants.sql` | 1.1 (fork grants/policies), 1.3, 1.2 | 1.1 before; rest after |

### Sequencing — binding

The Epic 1 order is **pinned, not advisory**: **1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**. This
story is **2nd**: it lands after 1.1 and **before** 1.3.

**Why 1.4 must precede 1.3.** `child_portal_tokens_child_id_fkey` is a *composite* FK onto
`public.children(account_id, id)` (`01_tables.sql:784-786`). Dropping the portal table first
removes a dependency the `children` → `singles` rename would otherwise have to carry through
its `ALTER TABLE … RENAME` migration — 1.3 already hand-writes five constraint renames, and
this would be a sixth on a table that is about to cease existing. It is also why every
`children`-named identifier quoted in this story is correct as written.

There is **no fallback branch for the reverse order.** If you open `01_tables.sql` and the FK
target reads `public.singles(account_id, id)` — or `05_policies.sql` names
`"Singles scoped to account"`, or `02_functions.sql` has `is_single_visible_state` — then 1.3
has landed out of order. **Stop and report it; do not adapt the edits.** Line numbers
throughout this story are measured against the pre-1.3, pre-1.5 tree and cannot be trusted
once the rename has run.

**What this story does *not* own, by ruling:**

- Every `child`-named **symbol** — `is_child_visible_state`, `isChildVisibleState`,
  `CHILD_VISIBLE_STATES`, and any other camelCase / SCREAMING_SNAKE compound — is **1.3's**
  (AC 8). This story deletes the files that *contain* portal symbols; it renames nothing.
- `src/App.tsx`'s remaining dead routes, the TopBar menu items and the `/import` surface are
  **1.5's** (3rd). This story only removes the `isPortalUrl` branch and its import from
  `App.tsx`; leave every other route alone (AC 2 also forbids inventing a `/portal` redirect).
- The fork `to anon` grants in `06_grants.sql:8-172` are **1.1's** (already landed).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: Retire the token portal] — the requirement: `portal/`, `child_portal_tokens` and `get_child_portal()` deleted with their tests, routes and provider methods; FR107 carried by Epic 9.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-9] — "the single opens the same screens as the parent with **no parallel interface**".
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-12] — opt-in discoverability and the revocable, expiring, logged share link (retained, Epic 9).
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "Greenfield engineering standard… when something is replaced the replaced thing is deleted in the same change"; "Isolation is enforced in Postgres, never in the application".
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23] — entities named for what they hold; fossils dropped outright, no aliases, views or redirects survive; CI fails on a reference to a retired name.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1] — REVOKE all grants from `anon`; the only anon-readable relation is the published-listing snapshot.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-3] — one SQL authority for child visibility (`is_child_visible_state`), retained by this story and renamed by 1.3; the dignity floor.
- [Source: _bmad-output/implementation-artifacts/EPIC1-CROSSCHECK.md#O4] — the 1.4-before-1.3 ordering, now binding rather than recommended.
- [Source: _bmad-output/implementation-artifacts/EPIC1-CROSSCHECK.md#G4] and [#D3] — `is_child_visible_state` / `isChildVisibleState` are 1.3's to rename; this story leaves them, it does not freeze them.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md] — the story that renames them (AC-4, Task 2) and that this one must precede.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-21] — listings/share model that carries FR107 in Epic 9.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.5: Revocable share links] — where the share link is actually delivered.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 6: The Single's Access] — the replacement: a single logs in and sees the same app, filtered (6.2 / 6.3 RLS + field scoping).
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md] — "single", not "child"; "listing"; "dignity floor".
- [Source: AGENTS.md#Database Management] — schema-first workflow; `db diff` / `migration up`; `02_functions.sql` must keep exact `pg_dump` format.
- [Source: .claude/rules/security-triggers.md] — RLS / grant / migration changes require a security review.
- [Source: .claude/rules/testing.md] — no skipped or quarantined tests; AAA; deterministic waits.
- [Source: .claude/rules/lsp-usage.md] — use `LSP findReferences` for TS symbol impact, `grep` only for the deliberate text sweep and for SQL identifiers.
- [Source: supabase/migrations/20260724170639_add_child_portal.sql:113-120] — the `HAND-FIXED (E7)` precedent showing `db diff` omits privilege statements.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
