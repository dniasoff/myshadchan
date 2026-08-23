---
title: 'Configurable photo reveal preference'
type: 'feature'
created: '2026-08-21'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '35703a85291c551459076a057b788bf511670c2a'
context:
  - '/home/daniel/repos/myshadchan/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Photo tabs currently require an explicit click to reveal every photo. The behavior is hard-coded, so a household that prefers normal image previews cannot configure it, and newly created accounts have no explicit product default.

**Approach:** Add a persisted account preference named `photo_reveal_on_click`, defaulting to `false`. Surface it in Settings as “Require click to reveal photos”; when enabled, preserve the existing local reveal-on-click behavior, and when disabled, show photos without the extra reveal affordance.

## Boundaries & Constraints

**Always:** Default to `false`; preserve the existing signed-URL flow and photo visibility/RLS rules; reveal state must remain local to the current page when the preference is enabled; only non-single account members may change the account preference, matching existing account update policy.

**Ask First:** None.

**Never:** Do not weaken storage or database photo permissions; do not expose signed URLs before the preference and photo rendering path intentionally require them; do not alter upload visibility, hiding, sharing, or demo-data behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|-----------------------------|----------------|
| Default account | Account row has the new column omitted by a pre-migration/fixture path | Treat it as `false`; photos display normally | No crash or blocked Photo tab |
| Preference enabled | Account preference is `true` | Each photo starts behind “Reveal”; signed URL is requested only after that click | Existing reveal error notification remains |
| Preference disabled | Account preference is `false` | Each photo displays without “Reveal”; signed URL is requested for display | Existing image/signing error path remains |
| Save failure | Authorized user toggles the setting and update fails | Show the existing settings save error and retain the previous value | No optimistic state is left falsely persisted |

</frozen-after-approval>

## Code Map

- `supabase/schemas/01_tables.sql` -- canonical `accounts` column definition and physical column order.
- `supabase/schemas/06_grants.sql` -- account update column grant for the new preference.
- `src/components/atomic-crm/types.ts` -- `Account` type consumed by settings and Photo tab.
- `src/components/atomic-crm/settings/PreferencesSection.tsx` -- persisted preference control, used by desktop and mobile Settings.
- `src/components/atomic-crm/resumes/PhotoTab.tsx` -- resolves the active account preference and passes it to photo cards.
- `src/components/atomic-crm/resumes/PhotoRevealCard.tsx` -- supports both immediate display and explicit reveal modes.
- `src/components/atomic-crm/resumes/PhotoTab.test.tsx` -- FakeRest coverage for default-off and enabled reveal behavior.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts` -- demo account fixture default.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` -- Settings and photo copy.

## Tasks & Acceptance

**Execution:**
- [x] Add `photo_reveal_on_click boolean not null default false` to the declarative accounts schema and migration; update authenticated account update grants and types.
- [x] Add a Settings switch with role/data-loading/error handling consistent with existing account preferences; add FakeRest defaults and test coverage.
- [x] Thread the active account preference into `PhotoRevealCard`; preserve lazy signing when enabled and support immediate display when disabled.
- [x] Update Photo tab tests for the default-off path, enabled reveal path, and setting persistence/error behavior.

**Acceptance Criteria:**
- Given a new or legacy account without an explicit preference, when Photo opens, then photos display without a Reveal button.
- Given an account with “Require click to reveal photos” enabled, when Photo opens, then no image or signed URL is requested until that photo’s Reveal button is clicked.
- Given an authorized non-single member, when the setting is changed, then the account preference persists and the Photo tab reflects it after reload.
- Given a single-role member, when Settings opens, then no enabled control permits changing the account preference.
- Given any preference or display mode, when photo visibility is `private_parent`, then existing RLS/storage restrictions remain unchanged.

## Spec Change Log

## Verification

**Commands:**
- `npx vitest --config vitest.config.ts --project app --run src/components/atomic-crm/resumes/PhotoTab.test.tsx src/components/atomic-crm/settings/PreferencesSection.test.tsx` -- expected: all targeted tests pass.
- `npx tsc --noEmit --project tsconfig.app.json` -- expected: no TypeScript errors.
- `npm run build` -- expected: production build succeeds.
- `git diff --check` -- expected: no whitespace errors.
