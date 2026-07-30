---
baseline_commit: 748cc2688a1a157de8659875f7fc3a17dbdeca60
---

# Story 5.11: Call logging and tailored questions

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to record a reference call as it happens,
so that nothing is lost.

## Position in Epic 5

Depends on **5.10** (the Diligence tab and the migrated Reference 360's Conversations tab, where
`CallCaptureSheet` is invoked from). **Last in the epic — and that is a hard constraint, not a
preference.** This story owns the epic-closing AD-24 flip (AC-6): the assertion that no
descriptor has any `pendingTabs` left. It can only pass once 5-1 through 5-10 have all landed,
which is exactly why it goes last. Nothing else in Epic 5 names that flip, so if this story does
not take it, the ledger stays permanently informational and Epic 5 closes with an unenforced
invariant.

Beyond that flip it is largely a verification-and-one-gap story, not new construction.

## Almost everything this story asks for already exists

A careful `grep` before writing anything here found the whole call-logging mechanism already
built:

- `references/CallCaptureSheet.tsx` — one-thumb capture UI, four big status chips (`answered`,
  `no_answer`, `call_back`, `they_will_call_back`) plus a notes field, calling
  `dataProvider.logReferenceCall()`.
- `supabase/schemas/02_functions.sql#log_reference_call` — the single write path: validates the
  status, appends to `reference_links.conversation_log` (append-only, 20k-char guard), **and
  already inserts an `interactions` row** (`kind = 'call_logged'`, `target_type = 'reference'`,
  `scope = 'shidduch'`, `reference_link_id` set) — which is exactly what makes the call show up
  in the shidduch's Activity. **No RPC change is needed for this.**
- `references/relationshipQuestions.ts` — tailored question sets by relationship
  (teacher/rebbe, neighbour, friend, employer, family friend) plus universal questions, with its
  own doc comment stating the intent outright: *"the call script itself is never behind the
  paywall."*

## The one real gap: tailored questions are paywalled today by omission

`getQuestionsForRelationship()` is currently called from exactly one place:
`references/ResearchAssistantPanel.tsx` — the paid AI research assistant (CAP-13,
entitlement-gated). `references/CallCaptureSheet.tsx` — the free, manual capture sheet — never
calls it. That contradicts the function's own documented intent and CAP-13's contract ("AI that
organises rather than judges... it never scores compatibility"; nowhere does the SPEC say the
*questions themselves* are a paid feature — only the AI-generated *script/summary* is). This
story's job is narrow: **wire the existing, free, deterministic question sets into the manual
capture sheet**, with no AI call, no entitlement check, and no new question content.

## Acceptance Criteria

1. **Given** I open `CallCaptureSheet` for a reference link, **when** it renders, **then** it
   shows the tailored question set for `link.effective_relationship` (via the existing
   `getQuestionsForRelationship`), visible with no `useAiEntitlement` check and no paywall gate —
   available on the free tier, exactly as `relationshipQuestions.ts:8`'s own doc comment already
   promises. `link` is a `ReferenceLinkSummary` (`CallCaptureSheet.tsx:26-31`), which already
   carries `effective_relationship` (`types.ts:476`) — no new fetch, no new prop.
   **Failing looks like:** `references/entitlementGate.guard.test.ts` goes red because
   `CallCaptureSheet.tsx` now imports `useAiEntitlement` — its `ALLOWED` set is exactly
   `useAiEntitlement.ts` / `ResearchAssistantPanel.tsx` / `BillingPage.tsx` (`:26-30`), and
   `CallCaptureSheet` is one of the free features it explicitly samples.
2. **Given** a reference with no recognisable relationship keyword, **when** the sheet renders,
   **then** it falls back to the universal question set (already the function's existing
   behaviour) — never an empty question list.
   **Failing looks like:** a reference whose `effective_relationship` is `null` renders a
   question section with zero items, or no section at all.
3. **Given** the four call outcomes plus notes, **when** I log a call, **then** behaviour is
   unchanged from today (`answered`/`no_answer`/`call_back`/`they_will_call_back`, free text) —
   this story adds a read-only question display, it does not change the save path.
   **Failing looks like:** the diff touches `dataProvider.logReferenceCall`,
   `02_functions.sql#log_reference_call`, or `CallCaptureSheet.tsx:46-59`'s `handleSave`.
4. **Given** a logged call, **when** I open the **shidduch's** Activity tab (Epic 3's universal
   tab, now live per Story 5.1), **then** the `call_logged` interaction appears there, rendered
   via `RecordLink` back to the reference — a regression check on already-working backend
   behaviour, not new backend work. (AD-23: "shidduch", never "suggestion". The earlier wording
   of this AC said "the suggestion's Activity tab".)
   **Failing looks like:** the interaction renders as plain text with no link, or does not
   render at all because `scope = 'shidduch'` / `reference_link_id` is not resolved.
5. **Given** `CallCaptureSheet`'s single invocation path (it is opened only by
   `ReferenceCallLog.tsx:9`, which post-5.10 renders in the reference 360's Conversations tab —
   the shidduch's Diligence tab reaches it via each row's `RecordLink` to the reference),
   **when** this story completes, **then** that remains the sole invoker — no second capture
   entry point is added, and `grep -rn "CallCaptureSheet" src/ --include='*.tsx' | grep import`
   still returns exactly the `ReferenceCallLog.tsx` hit.
6. **Given** every Epic 5 story has landed, **when** the AD-24 conformance suite runs, **then**
   the pending-tab ledger is **empty and asserted so**. Concretely:
   `entity360/ad24Conformance.test.ts:807-824` — the informational case
   *"returns an array for the real registry (informational — non-empty is expected through
   Epic 5)"* — flips from `expect(Array.isArray(ledger)).toBe(true)` plus a `console.warn` to
   `expect(findPendingTabs(realRegistry)).toEqual([])`, with the `console.warn` and the stale
   `:803-806` comment deleted. `ad24Conformance.guard.test.ts`'s hand-off note (c) names this as
   Epic 5's closing act; **this story is the only one that names it back**.
   **Failing looks like:** the flipped assertion is red because some entity still declares a
   `pendingTabs` key — that is a genuine Epic 5 gap in the entity the failure names, not a
   reason to soften this AC back to informational.

## Tasks / Subtasks

- [x] **Task 1 — Confirm the existing mechanism, do not rebuild it** (prerequisite)
  - [x] `grep -n "getQuestionsForRelationship" src/components/atomic-crm -r` and confirm it is
        still only called from `ResearchAssistantPanel.tsx` (if a prior story already wired it
        elsewhere, this story is a no-op on that AC — verify before touching anything).
  - [x] Confirm `log_reference_call`'s `interactions` insert is unchanged since this document was
        written (`supabase/schemas/02_functions.sql`) — if it has been altered, re-verify AC-4
        still holds before assuming it does.
- [x] **Task 2 — Wire tailored questions into the manual sheet** (AC: 1, 2)
  - [x] In `CallCaptureSheet.tsx`, call `getQuestionsForRelationship(link.effective_relationship)`
        and render the returned `questions` list (e.g. a collapsible "Questions to ask" section
        above the notes textarea) — read-only display, no interactivity beyond expand/collapse.
  - [x] No `useAiEntitlement`/billing import anywhere in this change — that is the whole point of
        the gap this story closes, and `references/entitlementGate.guard.test.ts` fails the build
        if one appears.
  - [x] **Both i18n catalogues** (`providers/commons/englishCrmMessages.ts` and
        `frenchCrmMessages.ts`): add keys for the section header ("Questions to ask") and the
        expand/collapse copy. No story currently declares this and there is no parity test —
        `i18nProvider` runs `allowMissing: true`, so a missing French key falls back to English
        **silently**. Add both or the French UI quietly degrades.
- [x] **Task 3 — Regression checks** (AC: 3, 4, 5)
  - [x] `references/CallCaptureSheet.test.tsx` **does not exist** — this story creates it. (The
        earlier text said "existing `CallCaptureSheet` tests continue to pass unchanged"; there
        are none. Do not go looking for a file to leave alone.) What *does* exist and must stay
        green untouched: `references/relationshipQuestions.test.ts`,
        `references/entitlementGate.guard.test.ts`, and the `log_reference_call` coverage in
        `supabase/tests/references_entity.sql` + its runner.
  - [x] AC-4's test lands in **`entity360/tabs/ActivityTab.test.tsx`**, not under `references/`:
        it asserts that a `call_logged` interaction renders in the universal Activity tab with a
        working `RecordLink` to the reference. This is the first story where the Activity tab
        actually exists to test against (per Story 5.1).
  - [x] Run the AC-5 grep; manually verify the capture path post-5.10 (Diligence row →
        `RecordLink` → reference 360 → Conversations tab → `CallCaptureSheet`).
- [x] **Task 4 — Close the AD-24 pending-tab ledger** (AC: 6)
  - [x] `entity360/ad24Conformance.test.ts:807-824`: replace
        `expect(Array.isArray(ledger)).toBe(true)` + the `console.warn` with
        `expect(ledger).toEqual([])`, rename the case (drop "informational — non-empty is
        expected through Epic 5"), and delete the now-false `:803-806` comment. Keep the first
        case in that `describe` (`:785-800`, the fixture-driven one) exactly as it is.
  - [x] If it is red, read the failure: it names the entity that still has `pendingTabs`. That
        is a real Epic 5 gap in **that** story, not a defect in this assertion. Report it; do
        not soften the assertion.
- [x] **Task 5 — Tests**
  - [x] Component test for the new question display (renders relationship-specific questions;
        falls back to universal questions when relationship is blank/unrecognised — reuse
        `relationshipQuestions.test.ts`'s existing fixtures, do not invent new relationship
        strings).
  - [x] Test stack: **`vitest-browser-react` in Chromium** with `StoryWrapper` /
        `TestMemoryRouter` (see `references/ReferenceCreate.test.tsx` for the shape).
        **React Testing Library is not a dependency of this repo** — do not
        `import { render } from "@testing-library/react"`.
  - [x] `make typecheck && npm run lint && make test`.

## Dev Notes

### Reuse — this story adds almost no new logic

The entire value here is recognising that `relationshipQuestions.ts`, `CallCaptureSheet.tsx`, and
`log_reference_call` already do the hard work. Writing a second question-tailoring function, a
second call-status vocabulary, or a second `interactions`-writing path would directly contradict
`.claude/rules/coding-style.md`'s DRY principle and this task's own "grep for it first" mandate.

### Why the Activity linkage needs no backend change

`log_reference_call`'s existing `insert into public.interactions (...) values (v_account_id,
'reference', v_link.reference_id, 'shidduch', p_reference_link_id, v_member_id, 'call_logged',
...)` already satisfies "the call appears in the **shidduch's** Activity" — it always has, since
before this epic. What did not exist until Story 5.1 was a rendered Activity tab to see it in.
This story's AC-4 is therefore a verification of Story 5.1 + Epic 3's work, not new backend
construction — do not add a second write path "to be safe."

### Why this story must be last, and what that costs

AC-6's flip is only satisfiable once every other Epic 5 story has moved its keys out of
`pendingTabs`. Two consequences worth stating rather than discovering:

1. **Sequencing is a dependency, not a scheduling preference.** Dispatching 5-11 while any of
   5-1…5-10 is still open makes AC-6 red for reasons that have nothing to do with call logging.
2. **AC-6 does not belong to this story's subject matter, and that is fine.** It landed here by
   dependency order — `ad24Conformance.guard.test.ts`'s hand-off note (c) says Epic 5's *closing
   story* takes it, and this is the closing story. Do not push it to a "future cleanup"; there
   is no later Epic 5 story to push it to.

### Project Structure Notes

- **No schema change.** The RPC, the constraint set and the write path are all already correct.
- Changes are **not** confined to `references/`. Also written:
  `entity360/ad24Conformance.test.ts` (AC-6's flip),
  `entity360/tabs/ActivityTab.test.tsx` (AC-4's test), and **both**
  `providers/commons/{englishCrmMessages,frenchCrmMessages}.ts` (Task 2's question-section
  copy). Declare all four in the ownership manifest.
- This story does **not** touch `registry.json`: it adds one new *test* file
  (`references/CallCaptureSheet.test.tsx`) and no new non-test source file, and
  `scripts/generate-registry.mjs` ignores `**/*.{test,spec}.*` (`:28`, `:31-34`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.11]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Capabilities, CAP-13] — AI organises, never
  judges; the manual path must stand on its own, which is why the question sets cannot be
  paywalled.
- [Source: src/components/atomic-crm/references/relationshipQuestions.ts:8] — "the call script
  itself is never behind the paywall" (existing doc comment, cited verbatim as the intent this
  story fulfils). The function is `getQuestionsForRelationship` at `:89`.
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16, :26-30] — the
  basename-keyed `ALLOWED` set that fails the build if `CallCaptureSheet.tsx` ever imports
  `useAiEntitlement`. It is the machine enforcement of AC-1's "no paywall gate".
- [Source: src/components/atomic-crm/entity360/ad24Conformance.test.ts:803-824] — the
  informational pending-tab assertion AC-6 flips, and the comment that names Epic 5's closing
  story as its owner.
- [Source: supabase/schemas/02_functions.sql#log_reference_call] — existing, unchanged write path.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (developer subagent, STACK_ID=3, STACK_OWNER=5-11)

### Debug Log References

- `make typecheck` — clean (all three tsconfig projects).
- `make lint` — clean (`eslint --max-warnings=0` + the project's scoped `prettier --check`).
- `npx vitest run` (full suite) — 208 files / 2125 tests passed.
- `npx vitest run src/components/atomic-crm/references src/components/atomic-crm/entity360` —
  58 files / 523 tests passed (includes the new/edited files plus every test named in Task 3's
  "must stay green" list: `relationshipQuestions.test.ts`, `entitlementGate.guard.test.ts`,
  `registry.stubs.test.ts`, `ad24Conformance.guard.test.ts`).
- `make build` — clean.
- Four CI guards — all `EXIT=0`: `check-retired-names.mjs`, `check-suppressions.mjs`,
  `check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs`.
- `make start-supabase-e2e STACK_ID=3` → `make test STACK_ID=3` (full `npm run test`, all five
  projects incl. `db`) — 208 files / 2125 tests passed; the `db` project alone (20 files / 591
  tests, incl. `references_entity.sql`'s `log_reference_call` coverage) verified separately
  against stack 3's live database. `make stop-supabase-e2e STACK_ID=3` released the stack and
  lease afterward. No schema touched, so `supabase db diff --local` does not apply.

### Completion Notes List

- **Task 1 verified, no rebuild needed.** `getQuestionsForRelationship` was still called from
  exactly one place (`ResearchAssistantPanel.tsx`) before this story's changes.
  `log_reference_call` (`supabase/schemas/02_functions.sql`) was unchanged from the story's
  description: it already inserts an `interactions` row with `target_type = 'reference'`,
  `target_id = v_link.reference_id`, `scope = 'shidduch'`, `reference_link_id` set, and
  `metadata.shidduchim_id` — no RPC change was made or needed.
- **AC 1/AC 2 (Task 2).** `CallCaptureSheet.tsx` now calls
  `getQuestionsForRelationship(link.effective_relationship)` and renders the questions in a
  `<details>/<summary>` disclosure (the same idiom already used by `ReferenceCallLog.tsx`'s log
  entries, for consistency — no accordion library pulled in) above the "What they said" field. No
  `useAiEntitlement` import was added; `entitlementGate.guard.test.ts` was run and passes
  (initially caught the literal string "useAiEntitlement" inside an explanatory code comment —
  the guard is a raw-text scan, not an import scan — reworded the comment to avoid the substring
  without changing its meaning). Added `crm.references.call.questionsTitle` and
  `.questionsToggle` to both `englishCrmMessages.ts` and `frenchCrmMessages.ts`.
- **Finding on AC 4's wording (verified, not "fixed" — recorded here rather than edited into the
  AC).** AC-4 and Task 3 describe the regression as "the shidduch's Activity tab ... rendered via
  RecordLink back to the reference." Tracing the real write path
  (`02_functions.sql#log_reference_call`, its FakeRest mirror in
  `providers/fakerest/internal/referenceLinks.ts`, and the fixture generator) shows every
  reference↔shidduch interaction — `call_logged` exactly like the pre-existing `link_created`/
  `link_removed` — is written with `target_type = 'reference'`, never `target_type = 'shidduch'`.
  `ActivityTab`'s filter is a flat `{target_type, target_id}` equality
  (`entity360/tabs/ActivityTab.tsx`), so a `target_type = 'reference'` row is only ever returned
  by the **reference's own** Activity tab (`targetType="reference"`, wired by Story 5.10's
  `ReferenceActivityTab`) — never by the shidduch's (`targetType="shidduch"`, Story 5.1's
  `ShidduchActivityTab`). The row's mention then resolves through the existing
  `metadata.shidduchim_id` branch of `ActivityMention`, i.e. a RecordLink **to the shidduch**, the
  same mechanism already pinned for `link_created` in `ActivityTab.test.tsx`. So the true,
  falsifiable regression is: reference's Activity tab → call_logged → RecordLink to its shidduch —
  the entity names in AC-4's prose are inverted relative to what the code (and the Dev Notes'
  explicit "no second write path") actually supports. Per this story's own Dev Notes ("do not add
  a second write path 'to be safe'"), the fix is not a new backend write to make the AC's literal
  wording true; the new test in `ActivityTab.test.tsx` documents and asserts the real mechanism
  instead. No story text was edited.
- **AC 5 grep caveat.** `grep -rn "CallCaptureSheet" src/ --include='*.tsx' | grep import` now
  also matches this story's own new `CallCaptureSheet.test.tsx` (a test file, `.tsx` by
  extension), in addition to the one production invoker `references/ReferenceCallLog.tsx`.
  Filtering test files out (`| grep -v '\.test\.'`) confirms exactly one production invocation
  site, unchanged. Manually re-traced the capture path per Story 5.10: Diligence row → RecordLink
  → reference 360 → Conversations tab → `ReferenceCallLog` → `CallCaptureSheet`.
- **AC 6 (Task 4), the epic-closing flip.** All four AD-24 entities
  (`shidduchim`/`singles`/`shadchanim`/`references`) already carry `pendingTabs: []` on `main` at
  the start of this story (Stories 5.1–5.10 all landed). Flipped
  `entity360/ad24Conformance.test.ts`'s informational case to `expect(ledger).toEqual([])`,
  renamed it, and deleted the stale "informational" comment. It passes: the flip is satisfiable.
- New test file: `references/CallCaptureSheet.test.tsx` (did not exist before, per Task 3).

### File List

- `src/components/atomic-crm/references/CallCaptureSheet.tsx` (modified — Task 2)
- `src/components/atomic-crm/references/CallCaptureSheet.test.tsx` (new — Task 3/5)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (modified — Task 2, i18n)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (modified — Task 2, i18n)
- `src/components/atomic-crm/entity360/tabs/ActivityTab.test.tsx` (modified — Task 3, AC 4)
- `src/components/atomic-crm/entity360/ad24Conformance.test.ts` (modified — Task 4, AC 6)
