# Implementation Plan — Story 16.2 "Diligence at a dignified distance" (FR68)

## Acceptance Criteria (from `epics.md`)

| # | Acceptance Criterion | Mechanical Verification |
|---|----------------------|-------------------------|
| AC1 | Given a suggestion visible to the single and reference calls happening on it, when the single opens it, they see that diligence is under way and how far it has got — the "N of M spoken to" shape Story 5.10 already renders for the parent — and **nothing** of what anybody said. | Unit test: render `SingleDiligenceProgressTab` with mocked RPC response `{ contacted: 2, total: 5, outstanding: 3 }`; assert UI shows "2 of 5 conversations done" and no reference names, relationships, phone numbers, or notes appear in the DOM. |
| AC2 | No name, relationship, phone number or note reaches the client, proven at the database and not by hiding a component. | Database test (`shidduch_diligence_progress_rls.sql`): as a `single` role, call `shidduch_diligence_progress(shidduchim_id)` for a visible shidduch; assert the returned JSON contains only `contacted`, `total`, `outstanding` — no `reference_name`, `relationship`, `phone`, `what_they_said`, or `conversation_log`. Negative test: same call for an invisible shidduch (different account, or `visibility != 'shared'`, or non-visible pipeline_state) returns `0/0/0` or is denied. |
| AC3 | The count is honest: it does not imply progress that has not happened, and it does not appear at all where no diligence has started. | Unit test: mocked RPC response `{ contacted: 0, total: 0, outstanding: 0 }` → component renders empty state (no progress line). Database test: shidduch with zero `reference_links` rows → function returns `{ contacted: 0, total: 0, outstanding: 0 }`. |
| AC4 | A negative test proves a single reading the same endpoint as a parent gets the count and never a word of content. | Database test: same `shidduch_diligence_progress` function called as `parent_admin` and as `single` for the same shidduch; both return identical JSON (counts only). Separate test: `parent_admin` calling `getList("reference_links")` returns full rows with content; `single` calling same is denied by RLS (zero rows). |

## FR63 Invariant

**Preference/diligence data must never be used to filter, rank, score or match anything.**  
This story adds a **read-only aggregate count** for display only. The function `shidduch_diligence_progress` returns only `contacted`, `total`, `outstanding`. No column in any table is added or modified that could be used as a signal. The existing `single_preferences` table comment (FR63) already establishes this invariant; no new mechanical guard is added here because the function's return type structurally cannot be used for filtering/ranking.

## Product Ambiguities (Owner Decisions Required)

| # | Ambiguity | Recommended Default | Owner Decision Needed |
|---|-----------|---------------------|----------------------|
| 1 | **Tab key name**: Should the new tab be a new key `"diligence-progress"` (visible only to `single`), or should the existing `"diligence"` tab key render conditionally (full for managers, count-only for singles)? | New key `"diligence-progress"` with `visibleTo: ["single"]` in the shidduch descriptor. Keeps the canonical tab set stable for non-single roles and avoids conditional render logic in the descriptor. | **Owner**: Confirm tab key strategy. If "conditional render on same key" is preferred, the plan changes: no new `TAB_KEYS` entry, no `CANONICAL_TAB_SETS` change, but the descriptor's `diligence` tab render function must branch on viewer role (requires `useCurrentMemberRole()` hook). |
| 2 | **Where the tab appears**: The AC says "When I open it [a suggestion visible to me]". Does this mean the tab appears on the **shidduch 360** (when a single opens a suggestion), or on the **single's own 360** (a summary across all their shidduchim)? | Shidduch 360 only — per-shidduch progress, matching the parent's Diligence tab. The single's own 360 already has a `shidduchim` tab listing their suggestions; per-shidduch progress belongs on the shidduch record. | **Owner**: Confirm location. If a cross-shidduch summary is also wanted on the single's 360, that is a separate tab/feature (not in this story's AC). |
| 3 | **Empty state wording**: When no diligence has started (`total = 0`), what does the single see? AC says "does not appear at all". | Render nothing (no tab, no empty state) when `total = 0`. The tab itself could be hidden via `visibleTo` logic, but `visibleTo` is role-based, not data-based. Simpler: the tab renders but shows a neutral "No reference conversations started yet" line (consistent with `ShidduchReferencesSection` empty state). | **Owner**: Confirm empty-state behaviour. "Does not appear at all" could mean the tab is omitted from the tab bar when `total = 0` — that requires data-aware tab visibility, which the current framework doesn't support. |
| 4 | **FakeRest provider**: The new RPC function must be emulated in the FakeRest provider for demo/development. | Add `shidduch_diligence_progress` to `fakeRestRpcHandlers` in `src/components/atomic-crm/providers/fakerest/dataProvider.ts`, returning deterministic counts from the in-memory `reference_links` array. | **Owner**: Confirm FakeRest emulation is in scope for this story (required for `make start-demo`). |

## File List (Every File the Plan Touches)

### Database Layer (4 files — no new table, but a SECURITY DEFINER function + grants + migration + test)

1. **`supabase/schemas/02_functions.sql`** — Add `shidduch_diligence_progress(p_shidduchim_id bigint) returns jsonb` SECURITY DEFINER function. Uses `current_context_id()` for tenant isolation. Returns only `{ contacted, total, outstanding }`.
2. **`supabase/schemas/06_grants.sql`** — Grant `EXECUTE` on `public.shidduch_diligence_progress(bigint)` to `authenticated` and `service_role`. Revoke from `anon`, `public`.
3. **Hand-written migration** (e.g., `supabase/migrations/20260810XXXXXX_shidduch_diligence_progress.sql`) — Creates the function and grants. Must be verified with `make check-migration-safety`.
4. **`supabase/tests/shidduch_diligence_progress_rls.sql`** — Database test suite mirroring `single_preferences_rls.sql` shape: seeds two households, two singles, reference_links with various call_status values; verifies `single` role gets counts only for own visible shidduchim, `parent_admin` gets same counts, cross-tenant calls return zeros/denied, zero-link shidduch returns `0/0/0`.

### Frontend Layer (5 files — new tab per the "five-file change" rule)

5. **`src/components/atomic-crm/shidduchim/SingleDiligenceProgressTab.tsx`** — New component. Fetches via `dataProvider.rpc('shidduch_diligence_progress', { shidduchim_id: record.id })`. Renders only the progress line ("N of M conversations done") + optional empty state. No reference names, relationships, phones, notes. Loading/error/skeleton states per UX-DR11.
6. **`src/components/atomic-crm/shidduchim/entityDescriptor.tsx`** — Add new tab to `shidduchimDescriptor.tabs`: `{ key: "diligence-progress", visibleTo: ["single"], render: () => <SingleDiligenceProgressTab /> }`. Inserted in canonical position (after `diligence` per `CANONICAL_TAB_SETS`).
7. **`src/components/atomic-crm/entity360/tabKeys.ts`** — Add `"diligence-progress"` to `TAB_KEYS` and `TAB_LABELS` (label: "Diligence progress").
8. **`src/components/atomic-crm/providers/commons/englishCrmMessages.ts`** — Add `crm.entity360.tab.diligence-progress: "Diligence progress"` under `entity360.tab`.
9. **`src/components/atomic-crm/entity360/ad24Conformance.ts`** — Add `"diligence-progress"` to `CANONICAL_TAB_SETS.shidduchim` array in canonical position (after `"diligence"`, before `"external-links"`).

### Documentation / Amendments

10. **`_bmad-output/implementation-artifacts/6-3-field-level-scoping-for-a-single.md`** — Amend Story 6.3's acceptance criteria / dev notes to note that `single` role **may** call `shidduch_diligence_progress` for visible shidduchim (one aggregate number), while still being denied row-level access to `reference_links` and `references`. This is the "narrows Story 6.3 by exactly one number" clause.

### FakeRest Provider (Conditional — only if Owner confirms #4 above)

11. **`src/components/atomic-crm/providers/fakerest/dataProvider.ts`** — Add RPC handler for `shidduch_diligence_progress` that filters in-memory `reference_links` by `shidduchim_id` and `account_id`, computes `summarizeCallProgress`, returns JSON.

## Task Breakdown (One File / One Concern Per Task)

| Task | File(s) | Description |
|------|---------|-------------|
| T1 | `supabase/schemas/02_functions.sql` | Add `shidduch_diligence_progress` SECURITY DEFINER function. |
| T2 | `supabase/schemas/06_grants.sql` | Grant EXECUTE on the function to `authenticated` + `service_role`; revoke from `anon`, `public`. |
| T3 | Migration file | Hand-written migration creating function + grants. Include comment: FR63 invariant — this function returns only aggregate counts, never content. |
| T4 | `supabase/tests/shidduch_diligence_progress_rls.sql` | Database test: two households, two singles, reference_links with mixed call_status. Verify single gets counts for own visible shidduchim only; parent gets same; cross-tenant returns zeros; zero links returns 0/0/0. |
| T5 | `src/components/atomic-crm/shidduchim/SingleDiligenceProgressTab.tsx` | New component. RPC call, loading/error/skeleton/empty states. Renders only progress line. No reference content. |
| T6 | `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` | Register new tab in `shidduchimDescriptor.tabs` with `visibleTo: ["single"]`. |
| T7 | `src/components/atomic-crm/entity360/tabKeys.ts` | Add `"diligence-progress"` to `TAB_KEYS` and `TAB_LABELS`. |
| T8 | `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` | Add i18n entry for `crm.entity360.tab.diligence-progress`. |
| T9 | `src/components/atomic-crm/entity360/ad24Conformance.ts` | Add `"diligence-progress"` to `CANONICAL_TAB_SETS.shidduchim` in canonical order. |
| T10 | `6-3-field-level-scoping-for-a-single.md` | Amend Story 6.3 doc: single may call `shidduch_diligence_progress` for visible shidduchim. |
| T11 | `src/components/atomic-crm/providers/fakerest/dataProvider.ts` | (If Owner confirms) Add FakeRest RPC handler for the function. |

## Verification Checklist (Pre-Commit)

- [ ] `make typecheck` passes
- [ ] `make lint` passes
- [ ] `make test` passes (including new database test `npm run test:unit:db -- shidduch_diligence_progress_rls`)
- [ ] `make check-migration-safety` passes (run against a seeded local stack)
- [ ] `npm run test:unit:db -- column_order` passes (no column-order drift from migration)
- [ ] AD-24 conformance test passes (`ad24Conformance.test.ts` — new tab key in canonical set, descriptor includes it)
- [ ] Negative test: `single` role cannot `select * from reference_links` for any shidduch (existing RLS unchanged)
- [ ] Negative test: `single` role calling `shidduch_diligence_progress` for invisible shidduch returns `0/0/0` or errors
- [ ] Light + dark mode, 375px viewport: tab renders correctly, no layout shift

## Notes on Story 16.1 Precedent

Story 16.1 (`single_preferences`) was a **new table** requiring 6 schema files. Story 16.2 adds **no new table** — only a SECURITY DEFINER function — so the schema file count is 4 (functions, grants, migration, test). The frontend tab addition follows the same 5-file pattern (component, descriptor, tabKeys, i18n, ad24Conformance). The composite FK / AD-1 trigger / sequence grants are not needed here because the function has no table to own.