# Remove all Hebrew from the UI — file-by-file removal checklist

Goal: **no Hebrew character rendered anywhere in the app UI, and no form
collects Hebrew.** Keep all English. Keep the DB columns and the TypeScript
`*_he` type fields (no migration, no `supabase/` edits — unused columns are
fine). i18n message *keys* stay (English text); only Hebrew *values* are
dropped. Tokens/layout unchanged except tidying a gap a removed line leaves.

## How Hebrew reaches the screen (three mechanics found)

1. **Bilingual "span-next-to-English"** — an English name/label rendered, then
   a sibling `<span className="font-hebrew" dir="rtl">{record.*_he}</span>`.
   → delete the Hebrew span (and its guarding ternary), keep the English.
2. **`|| *_he` fallback** — `record.name_en || record.name_he || "?"` used for
   a display string *or* a monogram seed. If `name_en` is empty this renders
   Hebrew (or a Hebrew monogram letter). → drop the `|| *_he` term; the final
   English fallback (`"?"`, `"Unnamed"`, `"#id"`, monogram of `id`) takes over.
3. **`font-hebrew` `TextInput` / `<Input>`** — a form field that *collects*
   Hebrew. → delete the field entirely (keep the English field).

Note: `font-hebrew` is a Tailwind v4 utility auto-generated from the
`--font-hebrew` theme token in `src/index.css`. Once every `font-hebrew` usage
below is gone, the token + `@fontsource-variable/heebo` import + package dep can
be removed (Category F).

`src/components/atomic-crm/misc/StateChip.tsx` renders only `def.label` (no
Hebrew) — **no change needed**, listed here so it isn't "missed".

---

## Category A — Name display (delete Hebrew span / drop `*_he` fallback)

- [ ] **`children/ChildCard.tsx`** — remove `nameHe` const (l.31-33); in the
  name block (l.68-85) drop both Hebrew branches so it becomes just
  `{nameEn || displayName}`; `displayName` (l.34) drop `|| nameHe`;
  `monogramSeed` (l.35) drop `|| child.first_name_he`. Update the docstring
  (l.19-26) that describes the "Hebrew on its own line" recipe.
- [ ] **`children/ChildShow.tsx`** — remove `nameHe` const (l.37-39) and its
  span (l.65-69); `monogramSeed` (l.40) drop `|| child.first_name_he`.
- [ ] **`children/index.ts`** — `recordRepresentation` (l.12-15) drop
  `|| record.first_name_he`.
- [ ] **`shidduchim/ShidduchCard.tsx`** — remove `nameHe` const (l.63) and its
  span (l.112-119).
- [ ] **`shidduchim/ShidduchShowHeader.tsx`** — remove the `name_he` span
  (l.59-66); the `<h1>` flex wrapper then holds one child (fine; optional tidy).
- [ ] **`shidduchim/ShidduchFactsCard.tsx`** — drop the `he` prop from `FactRow`
  (param l.11-16, render l.28-32); remove every `he={shidduch.*_he}` on the
  four `FactRow`s (l.64-79); simplify `hasAnyFact` (l.45-55) by removing the
  four `Boolean(shidduch.*_he)` terms. Keep all `en`/`plain` rows.
- [ ] **`shidduchim/ShidduchSchoolsSection.tsx`** — (display) l.81 drop
  `?? school.name_he`; remove the `name_he` span (l.83-90). (input) remove the
  `name_he` `TextInput` (l.118-122) and `name_he` from `onAddSchool` (l.46).
- [ ] **`shidduchim/ShidduchimList.tsx`** — `childLabel` (l.16-17) drop
  `?? child.first_name_he`; remove `nameHe` const (l.108) and its span
  (l.134-141). The "Pipeline — {nameEn}" `<h1>` then holds one child.
- [ ] **`shadchanim/ShadchanCard.tsx`** — remove the `name_he` span (l.56-63).
- [ ] **`shadchanim/ShadchanHeader.tsx`** — remove the `name_he` span (l.43-50).
- [ ] **`shadchanim/ShadchanSuggestions.tsx`** — remove the `name_he` span
  (l.70-77).
- [ ] **`references/ReferenceList.tsx`** — `name` (l.57) drop `|| record.name_he`;
  `monogram` seed (l.58) drop `|| record.name_he`; remove the `name_he` span
  (l.91-98).
- [ ] **`references/ReferenceShow.tsx`** — `ReferenceHeader`: `name` (l.35) and
  `monogram` (l.36) drop `|| reference.name_he`; remove the `name_he` span
  (l.62-69). `ReferenceShowLayout`: `name` (l.133) drop `|| record.name_he`.
- [ ] **`references/ReferenceMatchPanel.tsx`** — `displayName` (l.34-35) drop
  `|| candidate.name_he`; remove the `name_he` `<span>` (l.82-86) (note: this
  one is `ms-2`, not `font-hebrew`, but still Hebrew).
- [ ] **`references/RepeatRecognitionPanel.tsx`** — l.87 drop
  `|| link.shidduch_name_he`.
- [ ] **`references/CallCaptureSheet.tsx`** — `subject` (l.75) drop
  `|| link.shidduch_name_he`; l.87 drop `|| link.reference_name_he`.
- [ ] **`references/ReferenceCallLog.tsx`** — `shidduchName` (l.28-33) drop
  `|| link.shidduch_name_he`.
- [ ] **`references/ReferenceMergeCollision.tsx`** — l.65 drop
  `|| collision.shidduch_name_he`.
- [ ] **`references/ReferenceMergeButton.tsx`** — `displayName` (l.43-44) drop
  `|| reference?.name_he` (also affects the "same name in either script"
  comment l.61-62 — update wording).
- [ ] **`references/ReferenceTimeline.tsx`** — l.139 drop
  `|| link.shidduch_name_he`.
- [ ] **`references/ShidduchReferencesSection.tsx`** — l.73 drop
  `|| link.reference_name_he`.
- [ ] **`references/index.ts`** — `recordRepresentation` (l.12-13) drop
  `|| record.name_he`.
- [ ] **`dashboard/RecentSuggestions.tsx`** — remove the `name_he` span
  (l.65-72).
- [ ] **`dashboard/DashboardHeader.tsx`** — `childLabel` (l.13-16) drop
  `|| child.first_name_he`; remove `nameHe` const (l.26) and its span
  (l.36-43).
- [ ] **`layout/TopBar.tsx`** — `childLabel` (l.50-53) drop
  `|| child.first_name_he`; remove the `first_name_he` span (l.93-97).
- [ ] **`reminders/ReminderCard.tsx`** — remove the `linkedEntity.labelHe` span
  (l.68-72).
- [ ] **`reminders/reminderEntity.ts`** — in `targetEntityLabel`: change return
  type to `{ label: string }` (l.58); in the shidduch/reference/shadchan cases
  drop `|| (record.name_he as string)` from `label` and remove the `labelHe:`
  return keys (l.62-76).
- [ ] **`reminders/useReminders.ts`** — remove `labelHe` from `LinkedEntityRef`
  (l.24) and from the `linkedEntity` object built in `items` (l.132, 138).

## Category B — The 7 pipeline-state labels

- [ ] **`shidduchim/ShidduchColumn.tsx`** — remove the `state.labelHe` span
  (l.55-62); keep the English `<span>{state.label}</span>`. The
  `flex items-baseline gap-1.5` wrapper then holds one child (fine).
- [ ] **`shidduchim/pipelineStates.ts`** — `labelHe` no longer renders anywhere.
  Simplest: **remove** the `labelHe` field from `PipelineStateDef` (l.9-10) and
  from all 7 entries (l.29,36,43,50,58,65,72), and update the interface comment.
  (Acceptable alternative: leave the field but ensure nothing reads it.)
- [ ] **`dashboard/bucketByState.ts`** — `StateBucket.labelHe` (l.6) and its
  assignment (l.22) are already **not rendered** by `PipelineSnapshot`
  (uses `bucket.label`). Remove them for cleanliness (required if `labelHe` is
  dropped from `pipelineStates.ts`, since l.22 reads `def.labelHe`).
- [ ] `dashboard/PipelineSnapshot.tsx` — **no change** (renders `bucket.label`).

## Category C — Hebrew form inputs (stop collecting Hebrew)

- [ ] **`children/ChildInputs.tsx`** — remove the `first_name_he` TextInput
  (l.24-30) and the `last_name_he` TextInput (l.36-42). The name grid then holds
  `first_name_en` + `last_name_en` = fills both columns cleanly. Update the
  docstring (l.7-12) about "bilingual name fields paired side-by-side".
- [ ] **`shadchanim/ShadchanInputs.tsx`** — remove the `name_he` TextInput
  (l.30-36). **Layout tidy:** the `sm:grid-cols-2` name grid (l.23) now has one
  field → make `name` full-width (drop the grid or single-column).
- [ ] **`references/ReferenceInputs.tsx`** — remove the `name_he` TextInput
  (l.34-42). **Layout tidy:** the `sm:grid-cols-2` "Who" grid (l.26) now has one
  field → make `name_en` full-width. Update the docstring (l.11-12) about "both
  name scripts first-class".
- [ ] **`shidduchim/ShidduchInputs.tsx`** — remove the `name_he` TextInput
  (l.84-90) and the bilingual comment (l.75-76). **Layout tidy:** the
  `sm:grid-cols-2` grid (l.77) now has one field → make `name_en` full-width.
- [ ] **`shidduchim/ShidduchSchoolsSection.tsx`** — (input already listed in A).
- [ ] **`references/ReferenceCreate.tsx`** — remove the `name_he` `useWatch`
  (l.36), stop passing `name_he` to `useReferenceMatch` (l.44), and remove the
  `setValue("name_he", "", …)` clear (l.65).
- [ ] **`references/useReferenceMatch.ts`** — *optional*: the hook still accepts
  `name_he` and forwards it to the match RPC (l. `hasName`, destructure, deps).
  Matching logic can stay (harmless — form no longer supplies it). If tidying,
  drop the `name_he` param and its uses. Not required for the "no rendered
  Hebrew" goal.
- [ ] **`login/FirstRunSetup.tsx`** — remove the `first_name_he` `<Input>` block
  (l.240-252); drop `first_name_he` from the `useForm` generic + defaults
  (l.63-65); drop `first_name_he: values.first_name_he || null` from the
  create payload (l.92). Keep the English first-name field. (The
  `crm.auth.onboarding.child_first_name_he` message key then goes unused.)

## Category D — Accent lines, landing hero, i18n Hebrew values

- [ ] **`login/LoginPage.tsx`** — remove the Hebrew accent `<p>` (l.123-125,
  `רישום השידוכים`). Leave the English title/subtitle above it.
- [ ] **`login/SignupPage.tsx`** — remove the identical Hebrew accent `<p>`
  (l.130-132).
- [ ] **`landing/LandingHero.tsx`** — remove the entire Hebrew subtitle `<p>`
  (l.34-43, `crm.landing.hero.title_he` / `רישום של תהליך השידוכים`). The English
  `<h1>` (above) and lead paragraph (below) close the gap; check the `mt-*`
  rhythm still reads (lead is `mt-6`, was after the Hebrew `mt-5` block).
- [ ] **`landing/LandingStatesCard.tsx`** — remove the `state.labelHe` `<span>`
  (l.47-49). Each `<li>` is `flex items-center gap-4`; the row keeps number +
  dot + English label. **Layout tidy:** English label span is `flex-1` (l.35),
  so removing the trailing Hebrew span is clean; no gap left.
- [ ] **`providers/commons/englishCrmMessages.ts`** — remove
  `landing.hero.title_he` (l.470, Hebrew value). The `name_he` / `first_name_he`
  / `last_name_he` *label* keys (l.8, 27, 28, 39, 50 — English text like
  "Name (HE)") become unused once the inputs are gone; remove them too.
- [ ] **`providers/commons/frenchCrmMessages.ts`** — same removals: `title_he`
  (l.476) and the `*_he` label keys (l.10, 29, 30, 41, 52).
- [ ] **`landing/LandingPage.test.tsx`** — **test will break:** l.104 asserts
  `getByText("בטוח לא")` (the `for_sure_not` `labelHe`). Change the assertion to
  the English label `"For-sure-not"` (or remove it), matching the new render.

## Category E — Demo data generators (no Hebrew in seed data)

- [ ] **`providers/fakerest/dataGenerator/shidduchim.ts`** — set to `null` /
  remove Hebrew from: `shadchanimSeed[*].name_he` (l.27,34,41,52 — Hebrew
  values); `childrenSeed[*].first_name_he` + `last_name_he` (l.66,68,77,79);
  the `Seed.name_he` field (l.90) and every `name_he:` Hebrew value in
  `rivkySeeds` + `yaakovSeeds`; the `name_he: seed.name_he` mapping (l.285) →
  `name_he: null`. (`parents_he`/`seminary_he`/`shul_he`/`location_he` are
  already `null`.) Simplest: delete `name_he` from the `Seed` type + seed
  literals and hard-code `name_he: null` in the two `.map`s, and drop
  `first_name_he`/`last_name_he`/`name_he` from the shadchan + child seeds.
- [ ] **`providers/fakerest/dataGenerator/references.ts`** — remove the
  `name_he` Hebrew values in `referenceSeeds` (l.35,49,54,59,66,74,82,90,98);
  drop `name_he` from `ReferenceSeed` (l.21) and set `name_he: null` in the
  `references.map` (l.271), or remove the field. Keep all English names/phones
  (the near-duplicate merge demo relies on `name_en` + `phone`, not Hebrew).

## Category F — Font + token cleanup (optional; only after A–E land)

Do a final sweep — `grep -rn "font-hebrew" src/` and
`grep -rnP '[\x{0590}-\x{05FF}]' src/components` — before touching these.

- [ ] **`src/index.css`** — once no `font-hebrew` class remains: remove
  `@import "@fontsource-variable/heebo";` (l.4) and the `--font-hebrew` theme
  token (l.12-13).
- [ ] **`package.json`** — remove the `@fontsource-variable/heebo` dependency
  (l.32) if the import is gone.
- [ ] **`settings/LanguageSelector.tsx`** — *optional (not rendered):* the
  docstring comment (l.18-24) mentions Hebrew / contains `עברית`. Per the
  english-only rule, reword the comment; no UI Hebrew renders here (the locale
  catalog registers only English + Français).

## Leave as-is — NOT rendered UI (matching logic + unit-test fixtures)

These contain Hebrew string literals but never render in the app and exercise
the retained `*_he` columns; out of scope for "no rendered Hebrew":

- `providers/fakerest/internal/referenceIdentity.ts` + `.test.ts`
- `providers/fakerest/internal/referenceMatch.ts`
- `references/ReferenceMatchPanel.test.tsx` (already `name_he: null`)
- `shidduchim/boardUtils.test.ts` l.90 (`"שמואל"` is a `getMonogram` input)
- `providers/supabase/dataProvider.ts` (`p_name_he` etc. — passes the column
  through to the RPC; leave, since the column stays)
- `types.ts` (`*_he` fields — keep per the task)

---

## Layout-gap flags (where a removed line needs tidying)

1. **`ShadchanInputs`, `ReferenceInputs`, `ShidduchInputs`** — each has a
   `sm:grid-cols-2` "name" grid holding `name_en` + `name_he`. Removing the
   Hebrew input leaves a lone field in a 2-col grid (empty right half). Make the
   English field full-width (single column or drop the grid wrapper).
   (`ChildInputs` is fine — `first_name_en` + `last_name_en` still fill 2 cols.)
2. **Header `<h1>`s** (`ChildShow`, `ShadchanHeader`, `ShidduchShowHeader`,
   `DashboardHeader`, `ShidduchimList`) use
   `flex flex-wrap items-baseline gap-x-*` to sit English beside Hebrew. With
   the Hebrew span gone they hold one child — harmless, optional to unwrap.
3. **`LandingHero`** — the Hebrew `<p>` sat between the `<h1>` (mt-5) and the
   lead `<p>` (mt-6). Removing it just closes the stack; verify vertical rhythm.
4. Comment/docstring accuracy: `ChildCard`, `ChildInputs`, `ReferenceInputs`,
   `ShidduchInputs`, `pipelineStates.ts`, `ReferenceMergeButton` reference the
   now-removed bilingual behavior — update wording (english-only rule).

## Count

**~45 files require changes** (Categories A–E), plus **~3 optional** files
(Category F font/token cleanup + LanguageSelector comment). `StateChip.tsx` and
`PipelineSnapshot.tsx` are verified no-change. The "Leave as-is" list (6 items)
is intentionally untouched.
