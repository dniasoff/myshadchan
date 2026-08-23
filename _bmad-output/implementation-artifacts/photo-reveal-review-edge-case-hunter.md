# Edge Case Hunter Review: configurable photo reveal

Invoke the `bmad-review-edge-case-hunter` skill on the implementation described below.

Review scope (exclude unrelated pre-existing Serena/demo changes):

- `supabase/schemas/01_tables.sql`
- `supabase/schemas/06_grants.sql`
- `supabase/migrations/20260823011000_photo_reveal_preference.sql`
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/settings/PreferencesSection.tsx`
- `src/components/atomic-crm/settings/PreferencesSection.test.tsx`
- `src/components/atomic-crm/resumes/PhotoTab.tsx`
- `src/components/atomic-crm/resumes/PhotoTab.test.tsx`
- `src/components/atomic-crm/resumes/PhotoRevealCard.tsx`
- `src/components/atomic-crm/resumes/PhotoRevealCard.test.tsx`

Intent: add a persisted account-level `photo_reveal_on_click` preference, default false. Non-single members can change it in Settings. When false, photos display normally; when true, each photo remains behind the existing Reveal affordance and signed URLs are requested only after clicking. Existing photo visibility, storage, RLS, upload, hide, and demo behavior must remain unchanged.

Walk every branch: account/query loading, missing legacy values, role changes, setting save failures, context switching, Photo tab mount/unmount, signing success/failure/retry, hidden/private photos, and FakeRest versus Supabase. Return only actionable unhandled edge cases with file/line and a recommended fix.
