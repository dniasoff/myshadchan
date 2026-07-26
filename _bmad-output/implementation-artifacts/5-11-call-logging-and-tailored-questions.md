# Story 5.11: Call logging and tailored questions

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to record a reference call as it happens,
so that nothing is lost.

## Position in Epic 5

Depends on **5.10** (the Diligence tab and the migrated Reference 360's Conversations tab, where
`CallCaptureSheet` is invoked from). Last in the epic — it is largely a verification-and-one-gap
story, not new construction.

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
  in the suggestion's Activity. **No RPC change is needed for this.**
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
   available on the free tier, exactly as `relationshipQuestions.ts`'s own doc comment already
   promises.
2. **Given** a reference with no recognisable relationship keyword, **when** the sheet renders,
   **then** it falls back to the universal question set (already the function's existing
   behaviour) — never an empty question list.
3. **Given** the four call outcomes plus notes, **when** I log a call, **then** behaviour is
   unchanged from today (`answered`/`no_answer`/`call_back`/`they_will_call_back`, free text) —
   this story adds a read-only question display, it does not change the save path.
4. **Given** a logged call, **when** I open the suggestion's Activity tab (Epic 3's universal
   tab, now live per Story 5.1), **then** the `call_logged` interaction appears there, rendered
   via `RecordLink` back to the reference — a regression check on already-working backend
   behaviour, not new backend work.
5. **Given** `CallCaptureSheet`'s single invocation path (it is opened only by
   `ReferenceCallLog.tsx`, which post-5.10 renders in the reference 360's Conversations tab —
   the shidduch's Diligence tab reaches it via each row's `RecordLink` to the reference),
   **when** this story completes, **then** that remains the sole invoker — no second capture
   entry point is added, and `grep -rn "CallCaptureSheet" src/ --include='*.tsx' | grep import`
   still returns exactly the `ReferenceCallLog.tsx` hit.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the existing mechanism, do not rebuild it** (prerequisite)
  - [ ] `grep -n "getQuestionsForRelationship" src/components/atomic-crm -r` and confirm it is
        still only called from `ResearchAssistantPanel.tsx` (if a prior story already wired it
        elsewhere, this story is a no-op on that AC — verify before touching anything).
  - [ ] Confirm `log_reference_call`'s `interactions` insert is unchanged since this document was
        written (`supabase/schemas/02_functions.sql`) — if it has been altered, re-verify AC-4
        still holds before assuming it does.
- [ ] **Task 2 — Wire tailored questions into the manual sheet** (AC: 1, 2)
  - [ ] In `CallCaptureSheet.tsx`, call `getQuestionsForRelationship(link.effective_relationship)`
        and render the returned `questions` list (e.g. a collapsible "Questions to ask" section
        above the notes textarea) — read-only display, no interactivity beyond expand/collapse.
  - [ ] No `useAiEntitlement`/billing import anywhere in this change — that is the whole point of
        the gap this story closes.
- [ ] **Task 3 — Regression checks** (AC: 3, 4, 5)
  - [ ] Existing `CallCaptureSheet`/`log_reference_call` tests continue to pass unchanged (no
        save-path edits).
  - [ ] Add a test asserting a `call_logged` interaction renders in the Activity tab with a
        working `RecordLink` to the reference (this is the first story where the Activity tab
        actually exists to test against, per Story 5.1).
  - [ ] Run the AC-5 grep; manually verify the capture path post-5.10 (Diligence row →
        `RecordLink` → reference 360 → Conversations tab → `CallCaptureSheet`).
- [ ] **Task 4 — Tests**
  - [ ] Component test for the new question display (renders relationship-specific questions;
        falls back to universal questions when relationship is blank/unrecognised — reuse
        `relationshipQuestions.test.ts`'s existing fixtures, do not invent new relationship
        strings).
  - [ ] `make typecheck && npm run lint && make test`.

## Dev Notes

### Reuse — this story adds almost no new logic

The entire value here is recognising that `relationshipQuestions.ts`, `CallCaptureSheet.tsx`, and
`log_reference_call` already do the hard work. Writing a second question-tailoring function, a
second call-status vocabulary, or a second `interactions`-writing path would directly contradict
`.claude/rules/coding-style.md`'s DRY principle and this task's own "grep for it first" mandate.

### Why the Activity linkage needs no backend change

`log_reference_call`'s existing `insert into public.interactions (...) values (v_account_id,
'reference', v_link.reference_id, 'shidduch', p_reference_link_id, v_member_id, 'call_logged',
...)` already satisfies "the call appears in the suggestion's Activity" — it always has, since
before this epic. What did not exist until Story 5.1 was a rendered Activity tab to see it in.
This story's AC-4 is therefore a verification of Story 5.1 + Epic 3's work, not new backend
construction — do not add a second write path "to be safe."

### Project Structure Notes

- All changes stay inside `references/`; no schema change in this story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.11]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Capabilities, CAP-13] — AI organises, never
  judges; the manual path must stand on its own, which is why the question sets cannot be
  paywalled.
- [Source: references/relationshipQuestions.ts] — "the call script itself is never behind the
  paywall" (existing doc comment, cited verbatim as the intent this story fulfils).
- [Source: supabase/schemas/02_functions.sql#log_reference_call] — existing, unchanged write path.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
