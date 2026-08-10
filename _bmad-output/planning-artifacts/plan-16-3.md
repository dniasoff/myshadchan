# Story 16.3 "A space that is hers" — Plan (FR69, PRV-4)

## 1. Acceptance Criteria & Mechanical Verification

| # | AC | Mechanical Verification |
|---|----|-------------------------|
| 1 | A single writes a private note; it is invisible to every other household member, enforced in Postgres | RLS policy on `single_notes`: `FOR ALL` for `single` role only where `single_id` links to `current_member_id()`. Negative test: `parent_admin`/`helper`/`shadchan` select returns 0 rows for the single's private notes. |
| 2 | Single can share any note per-note, revocably | Column `visible_to_manager boolean not null default false` on `single_notes`. RLS policy: `FOR SELECT` for `parent_admin`/`self_manager` where `visible_to_manager = true`. Test: toggle `visible_to_manager` and verify manager sees/hides row immediately. |
| 3 | Parent's working notes remain equally invisible to single — PRV-4 symmetric, no weakening | Parent private notes stored in `interactions` (scope='account', kind='note') or new `parent_notes` table. RLS denies `single` role on parent-private rows. Negative test: `single` selects parent's private notes → 0 rows. Existing parent visibility unchanged (regression test). |
| 4 | Transparency posture dial-up by agreement, never below dignity floor | Account-level `transparency_level` (already in `accounts` table). RLS policies reference it only to *widen* visibility, never to narrow below dignity floor (live prospects + single input always visible). Test: set `transparency_level='open'`, verify single still cannot see parent private notes unless explicitly shared. |
| 5 | Negative tests prove both directions | Two test files: `single_notes_rls.sql` (single→manager denial, manager→single denial) and `parent_notes_rls.sql` (parent→single denial, single→parent denial). Each seeds control rows as superuser, then asserts authenticated roles see exactly the permitted subset. |

## 2. Role-by-Role Visibility Table

| Role | Can See Single's Private Notes | Can See Parent's Private Notes | Can Share Own Notes | Status |
|------|-------------------------------|-------------------------------|---------------------|--------|
| `single` | Own notes (all); sibling's notes (never) | Never | Yes, per-note via `visible_to_manager` | **follows precedent** (single_preferences) |
| `parent_admin` | Only where `visible_to_manager=true` | Own notes (all) | N/A (parent shares via separate mechanism) | **follows precedent** (single_preferences manager policy) |
| `self_manager` | Only where `visible_to_manager=true` | Own notes (all) | N/A | **follows precedent** (same as parent_admin in single_preferences) |
| `helper` | **Owner decision** — precedent denies (single_preferences grants helper nothing) | **Owner decision** — precedent denies | **Owner decision** | **needs owner decision** |
| `shadchan` | **Owner decision** — precedent denies (single_preferences grants shadchan nothing) | **Owner decision** — precedent denies | **Owner decision** | **needs owner decision** |

> **Note**: Do not copy `visibleTo` from neighbouring tabs. In Story 16.1, `visibleTo: ['parent_admin', 'self_manager']` on the *tab* would have hidden the Preferences tab from the single herself. The single must see the tab and her own rows; only the *manager's read* is gated by `visible_to_manager`.

## 3. File List

### New Table: `single_notes` (6 files)

| File | Purpose |
|------|---------|
| `supabase/schemas/01_tables.sql` | `create table public.single_notes (id bigserial pk, account_id bigint not null, single_id bigint not null, body text not null, visible_to_manager boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now());` + composite FK `(account_id, single_id) references singles(account_id, id)` + indexes |
| `supabase/schemas/04_triggers.sql` | `create or replace trigger set_single_notes_account_id before insert on public.single_notes for each row execute function public.set_account_id_default();` |
| `supabase/schemas/05_policies.sql` | Two policies: (1) `FOR ALL` for `single` where `single_id` links to `current_member_id()`; (2) `FOR SELECT` for `parent_admin`/`self_manager` where `visible_to_manager=true`. Mirror single_preferences pattern exactly. |
| `supabase/schemas/06_grants.sql` | Table: `grant select, insert, update, delete on public.single_notes to authenticated; grant all to service_role; revoke from anon.` Sequence: same grants on `single_notes_id_seq`. |
| `supabase/migrations/<timestamp>_single_notes_private_space.sql` | Generated via `npx supabase db diff --local -f single_notes_private_space`. Must include `security_invoker = on` for any views touched. |
| `supabase/tests/single_notes_rls.sql` | Negative test suite mirroring `single_preferences_rls.sql`: control rows as superuser, then authenticated assertions for single (sees all own), parent_admin (sees only shared), outsider parent_admin (sees 0), single cannot write to sibling's `single_id`. |

### New Tab: "Private Notes" on Single 360 (5 files)

| File | Purpose |
|------|---------|
| `src/components/atomic-crm/singles/descriptors/singlePrivateNotesDescriptor.ts` | EntityDescriptor for the tab: `label: 'Private Notes'`, `icon: LockIcon`, `tabKey: 'privateNotes'`, `visibleTo: ['single']` (single sees tab; manager sees tab only if any shared rows exist — computed, not static). |
| `src/components/atomic-crm/singles/descriptors/singlePrivateNotesDescriptor.test.ts` | Unit test: descriptor renders, tabKey unique, visibleTo logic correct for each role. |
| `src/components/atomic-crm/entity360/tabKeys.ts` | Add `'privateNotes'` to `TabKey` union. |
| `src/components/atomic-crm/locales/en.json` | Add `crm.single.tabs.privateNotes`, `crm.single.privateNotes.empty`, `crm.single.privateNotes.share`, `crm.single.privateNotes.unshare`. |
| `src/components/atomic-crm/entity360/ad24Conformance.ts` | Add `'privateNotes'` to `NO_BROWSE_SURFACE_ENTITIES` allowlist (it has no list route) and to `TAB_KEY_REGISTRY` conformance check. |

## 4. Tenant Isolation

- **Composite FK**: `alter table public.single_notes add constraint single_notes_single_id_fkey foreign key (account_id, single_id) references public.singles(account_id, id) on delete cascade;`
- **`account_id` server-set**: Trigger `set_single_notes_account_id` calls `public.set_account_id_default()` (SECURITY DEFINER, reads `current_context_id()` from JWT claims). Client never sends `account_id`.
- **RLS `with check`**: Both policies include `account_id = public.current_context_id()` in `using` and `with check` clauses. Insert/update by single cannot target another account's single.

## 5. Tasks (One File or One Concern Each)

| Task | File/Concern | Notes |
|------|--------------|-------|
| T1 | `01_tables.sql` — table definition + composite FK + indexes | Column order at physical tail (COLUMN-ORDER TRAP). |
| T2 | `04_triggers.sql` — account_id trigger | Exact copy of `set_single_preferences_account_id` pattern. |
| T3 | `05_policies.sql` — RLS policies | Two policies mirroring single_preferences. No helper/shadchan grants. |
| T4 | `06_grants.sql` — table + sequence grants | Full CRUD to authenticated, revoke anon. |
| T5 | Migration generation | `npx supabase db diff --local -f single_notes_private_space` → verify no phantom drops. |
| T6 | `single_notes_rls.sql` — negative test suite | Control rows + 5 assertions (single sees all, manager sees shared only, outsider sees 0, single cannot write sibling, manager cannot write). |
| T7 | Descriptor + test | `visibleTo: ['single']` only; manager tab visibility computed at render time. |
| T8 | `tabKeys.ts` + i18n + `ad24Conformance.ts` | Registry updates only. |
| T9 | Parent private notes symmetry | **Owner decision**: reuse `interactions` (scope='account', kind='note') with RLS denying `single`, or new `parent_notes` table. Story 6.3 already denies single on interactions via scope join — verify coverage. |

## 6. Owner Decisions (Flagged, Not Resolved)

| # | Decision | Precedent | Recommendation |
|---|----------|-----------|----------------|
| 1 | Does `helper` role see single's private notes when shared? | single_preferences: **no** (helper not in manager policy) | Keep denied unless owner explicitly adds. |
| 2 | Does `shadchan` role see single's private notes when shared? | single_preferences: **no** (shadchan not in manager policy) | Keep denied — shadchan sees only threads they're party to (FR113). |
| 3 | Parent's "working notes" storage: reuse `interactions` (scope='account') or new `parent_notes` table? | Interactions already has `scope='account'` + `kind='note'` + RLS denying single (Story 6.3). | Reuse `interactions` if RLS already blocks single; otherwise new table mirroring single_notes shape. |
| 4 | Sharing granularity: boolean `visible_to_manager` (per-note) or per-role? | single_preferences: boolean per-row. | Boolean per-row (simpler, matches precedent). |
| 5 | Transparency posture dial-up: account-level `transparency_level` widens single→parent visibility? | `accounts.transparency_level` exists; PRV-4 says "family may dial UP to fully open but NEVER below dignity floor". | RLS policies check `transparency_level='open'` only to *add* visibility (e.g., parent sees single's notes without explicit share). Never removes dignity floor (live prospects + single input). |
| 6 | Single's private notes tab visibility for manager: show tab only when shared rows exist, or always show empty? | Precedent: single_preferences has no tab (preferences are inline). | Show tab for single always; for manager, show only if `exists(select 1 from single_notes where visible_to_manager=true and single_id=...)` — computed, not static `visibleTo`. |