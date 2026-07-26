# Story 11.3: Diligence dossier

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the reference calls on a suggestion summarised into what everyone agreed on, where
they differed, and what nobody was asked,
so that I can see the whole picture without re-reading every call log entry myself.

## Position in Epic 11

**3rd of 3.** Depends on **11.1** the same way 11.2 does: `requireAiEntitlement`,
`c.get("supabaseCaller")` / `c.get("aiEntitlement")`, and `callAiWorker()` already exist and are
not rebuilt here.

**Cross-epic dependency the epic list does not state:** the dossier is scoped **per suggestion**
(*"Given several logged reference calls [on a suggestion]... When I open the dossier"*) — the
per-shidduch diligence workspace that hosts it is **Epic 5 Story 5.10**'s
("Reference 360 and per-shidduch diligence") to build, and it lands before Epic 11 in the epic
order but epics.md never states the dependency. This story assumes 5.10 has already relocated
the per-shidduch reference/call-log workspace out from under the old standalone `references/`
top-level surface (`design-artifacts/gap-analysis-v3.md` §6 calls this relocation "not a
rebuild — most mechanics are written"). **Locate 5.10's resulting component at implementation
time** (`grep -rn "buildCrossReferenceSummary\|useAiEntitlement" src/components/atomic-crm/` —
do not assume a filename this document cannot verify, since 5.10 doesn't exist yet); wire this
story's dossier fetch into whatever that component turns out to be, following the adaptation
rule in Dev Notes.

**This story deletes and relocates code that predates it** — read "What moves, what stays, what
is deleted" in Dev Notes before starting.

## Acceptance Criteria

1. **The fact engine moves to where it is actually computed now.**
   `src/components/atomic-crm/references/crossReferenceSummary.ts` and its test are **deleted**
   from `src/` (not aliased, not re-exported — NFR-14) and their content becomes
   `workers/ai/dossierFacts.ts` (+ `.test.ts`), unchanged in logic (`buildCrossReferenceSummary`,
   `COVERAGE_TOPICS`, the endorsement/hesitation cue lists) — this is a **move**, not a rewrite;
   the existing 12 topic/consensus/contradiction test cases carry over verbatim onto the new
   path. `callStatus.ts` **stays in `src/`, unmoved** — it is used outside the dossier (call-log
   chips) and is imported into the Worker by value (see Dev Notes "The `src/` ↔ `workers/` type
   boundary, extended").
2. **A new gated route:** `POST /dossier` in `workers/ai/index.ts`, added after `app.use("*",
   requireAiEntitlement)` (11.1). Body: `{ shidduchim_id: number }`. Uses
   `c.get("supabaseCaller")` — no second client, no second `ai_entitlement()` call.
3. **Draws only on this account's own records, enforced by Postgres, not by application code**
   (AD-1). The route selects from `reference_links_summary` filtered by `shidduchim_id` through
   the caller-scoped client; it never adds its own `account_id` filter. A `shidduchim_id`
   belonging to another account, or one that doesn't exist, both resolve to **zero rows** under
   RLS and produce the **identical** "nothing logged yet" response (AC-6) — never a distinct
   error that would let a caller distinguish "not mine" from "doesn't exist."
4. **The facts are computed server-side, from the rows this request just fetched — never from
   client-submitted facts.** `buildCrossReferenceSummary(links)` (relocated, AC-1) runs inside
   this route on the rows AC-3 fetched. No parameter of `POST /dossier` lets a caller supply
   precomputed `covered`/`gaps`/`hasContradiction` values — the only client input is
   `shidduchim_id`.
5. **The narrative is AI-generated, strictly grounded, and never blocks on the model.** A
   `DossierNarrator.compose(facts: DossierFacts): Promise<string>` interface
   (`workers/ai/dossierNarrator.ts`); the production implementation calls Claude **only through
   the Cloudflare AI Gateway** (`@anthropic-ai/sdk` with `baseURL` overridden, per the Stack
   table) with a prompt containing **only** the computed topic labels/counts/booleans — never
   raw `what_they_said` text or reference names. The response is checked against a fixed
   banned-phrase list (`recommend`, `compatible`, `match`, `score`, `should date`, `good fit`,
   case-insensitive); a hit, a thrown error, or a Gateway failure all fall back to
   `deterministicNarrative(facts)` (a template string built purely from the facts, no model
   call) — the route always returns a narrative, and a broken/absent Gateway credential
   degrades the feature, it never fails the request.
6. **The response shape:** `{ spokenToCount, outstandingCount, covered: string[], gaps:
   string[], hasContradiction: boolean, narrative: string }` — `covered`/`gaps` are topic
   labels (`CoverageTopic.label`), not the internal cue lists.
7. **It never judges compatibility or suggests a match (FR63/NFR "never fabricate").** Neither
   the deterministic path nor a passed AI narrative may contain a scored verdict — enforced
   mechanically by the banned-phrase check in AC-5, plus a test asserting the same list of
   phrases never appears in `deterministicNarrative`'s own output for any fixture.
8. **The paid gate covers only the dossier fetch — not the free reference-question feature.**
   Whatever component 5.10 produced that also renders `relationshipQuestions.ts`'s tailored
   questions must **not** be wrapped in the same entitlement check as the dossier call; only the
   dossier section may show an upgrade prompt in place of content when `useAiEntitlement()`
   reports unentitled (client-side hint, same as today) — the actual enforcement is AC-2's
   server gate regardless of what the client renders.
9. **The client fetches, it does not compute.** The relocated component's summary UI calls
   `callAiWorker(`${VITE_AI_WORKER_URL}/dossier`, { shidduchim_id })` (11.1) and renders the
   returned `covered`/`gaps`/`hasContradiction`/`narrative` — it performs no local
   `buildCrossReferenceSummary` call (there is none left to call after AC-1).
10. **The entitlement-gate guard test is updated, not left stale.**
    `references/entitlementGate.guard.test.ts`'s `ALLOWED` set currently names
    `ResearchAssistantPanel.tsx`, which this story's dependency (5.10) may have renamed or
    relocated, and `useAiEntitlement` is still the correct hook for the client-side hint (AC-8).
    Update `ALLOWED` to whatever file now calls `useAiEntitlement` for the dossier, confirmed
    via `LSP findReferences` on `useAiEntitlement` — the guard must still pass, and its
    intent (AI stays a narrow, free-features-never-touch-it gate) must still hold.
11. **Negative test.** The cross-account case (AC-3) already rests on RLS that
    `supabase/tests/references_entity.sql:379` already proves
    (`'RLS: reference_links_summary is invisible cross-account'`) — **do not duplicate that SQL
    test**. Add a Worker-level test instead: `workers/ai/index.test.ts` — a caller whose
    `shidduchim_id` resolves to zero rows (mocked) receives the AC-6 "nothing logged yet"
    shape, not an error and not another account's data.
12. **Verification.** `make typecheck`, `npm run lint`, `npm run test:unit:workers`, the `app`
    project's tests for the touched/relocated files, and `npm run test:unit:db` all pass.
    `npx prettier --config ./.prettierrc.json --check` over every file this story creates,
    moves or touches. `grep -rn "buildCrossReferenceSummary" src/` returns **zero** hits (fully
    relocated); `grep -rn "buildCrossReferenceSummary" workers/` returns the new home.

## Tasks / Subtasks

- [ ] **Task 1 — Relocate the fact engine** (AC: 1)
  - [ ] `git mv src/components/atomic-crm/references/crossReferenceSummary.ts
        workers/ai/dossierFacts.ts` and `git mv
        src/components/atomic-crm/references/crossReferenceSummary.test.ts
        workers/ai/dossierFacts.test.ts`.
  - [ ] Fix the moved file's imports: `ReferenceLinkSummary` becomes a **type-only** cross-
        boundary import (`import type { ReferenceLinkSummary } from
        "../../src/components/atomic-crm/types"`); `getCallStatusDescriptor` becomes a **value**
        cross-boundary import from `../../src/components/atomic-crm/references/callStatus`
        (framework-free — verify with `grep -n "^import" src/components/atomic-crm/
        references/callStatus.ts` before relying on this; it must show only `import type`
        lines, same as when this story was written).
  - [ ] Update the moved test's imports identically.

- [ ] **Task 2 — The route** (AC: 2, 3, 4, 6)
  - [ ] `workers/ai/index.ts`: `app.post("/dossier", handler)` after `app.use("*",
        requireAiEntitlement)`. Handler: fetch `reference_links_summary` filtered by
        `shidduchim_id` via `c.get("supabaseCaller")`; run `buildCrossReferenceSummary`; shape
        the AC-6 response; on zero rows return the same shape with `spokenToCount: 0,
        outstandingCount: 0, covered: [], gaps: <all topic labels>, hasContradiction: false,
        narrative: <the "nothing logged yet" deterministic string>` rather than a special-cased
        error path (AC-3).
  - [ ] `index.test.ts`: happy path with fixture links (reuse the moved test file's fixtures —
        do not invent new ones); zero-rows case (AC-11).

- [ ] **Task 3 — The narrator** (AC: 5, 7)
  - [ ] `workers/ai/dossierNarrator.ts`: `DossierNarrator` interface,
        `deterministicNarrative(facts)` (a direct port of the sentence-building already visible
        in `ResearchAssistantPanel.tsx`'s JSX today — "X spoke warmly and Y raised a
        reservation," "Nothing recorded yet," etc. — as plain string templates, not JSX), the
        banned-phrase constant and checker, and `claudeNarrator: DossierNarrator` calling the
        AI Gateway with `@anthropic-ai/sdk` (`baseURL` override). Extend `AiEnv` (new, in
        `workers/ai/index.ts`) with `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`,
        `ANTHROPIC_API_KEY`; add all three to `workers/ai/wrangler.toml`'s secrets comment.
  - [ ] `dossierNarrator.test.ts`: a banned-phrase hit in a fake model response falls back to
        deterministic; a thrown/rejected call falls back to deterministic; `deterministicNarrative`
        never contains a banned phrase for any of the fixture facts (AC-7), asserted with a
        loop over the banned-phrase list.

- [ ] **Task 4 — Client wiring** (AC: 8, 9, 10)
  - [ ] Locate 5.10's resulting per-shidduch diligence/summary component (see "Position in
        Epic 11"); replace its local `buildCrossReferenceSummary(links)` call with
        `callAiWorker(`${import.meta.env.VITE_AI_WORKER_URL}/dossier`, { shidduchim_id })`,
        rendering the response's `covered`/`gaps`/`hasContradiction`/`narrative`. Keep the
        existing `useAiEntitlement()` upgrade-prompt branch (AC-8) around the dossier section
        only — the relationship-questions section (if 5.10 kept it adjacent) stays ungated.
  - [ ] Update `references/entitlementGate.guard.test.ts`'s `ALLOWED` set per AC-10.

- [ ] **Task 5 — Final verification** (AC: 11, 12)
  - [ ] Run the two AC-12 greps; confirm zero hits in `src/`, one home in `workers/`.
  - [ ] `make typecheck && npm run lint && npm run test:unit:workers && npm run test:unit:db`
        and the `app` project's tests for every touched/relocated file.
  - [ ] `npx prettier --config ./.prettierrc.json --check` over every file this story creates,
        moves or touches.

## Dev Notes

### What moves, what stays, what is deleted

| Item | Disposition | Why |
|---|---|---|
| `crossReferenceSummary.ts` + its test | **Moved** to `workers/ai/` | It becomes the fact input to an actual inference call (the narrative); AD-7 makes Workers the compute home, and computing the facts from rows the client never sees (AC-4) is what makes "draws only on this account's own records" a server guarantee instead of a client convention. |
| `callStatus.ts` | **Unchanged, stays in `src/`** | Used outside the dossier (call-status chips elsewhere); it has zero React/DOM dependency in its own import chain (only `import type` from `../types`), so importing it *by value* into the Worker is safe without moving it — moving it would needlessly touch every other caller. |
| `relationshipQuestions.ts` | **Untouched by this story** | Not part of epics.md's Story 11.3 AC (only the dossier is named). It is free today and this story must not change that (AC-8). |
| `ResearchAssistantPanel.tsx` (or whatever 5.10 renamed it to) | **Adapted, not deleted by this story** | It is 5.10's file to relocate into the per-shidduch workspace; this story only swaps its data source from a local computation to a Worker fetch (Task 4). |

### The `src/` ↔ `workers/` type boundary, extended

11.1 established: type-only cross-boundary imports are always fine (erased at build). This
story adds the second, narrower case: a **value** cross-boundary import is fine when the
source module's own transitive import chain is provably framework-free — verified here by
`callStatus.ts` importing only `import type { CallStatus, ConversationLogEntry } from
"../types"` (no runtime import at all, of anything). Re-verify this with the grep in Task 1
before relying on it; if a future edit to `callStatus.ts` adds a real (non-type) import of
something React/DOM-flavored, this pattern breaks and `callStatus.ts` must be duplicated or
moved instead — that is a signal to catch in review, not something to guard against
speculatively here.

### Why the narrative is grounded on facts, never on raw quotes

Passing `what_they_said`/`conversation_log` text directly to the model would (a) risk the model
quoting or paraphrasing candid reference words in ways nobody reviewed, and (b) make the
"never fabricates" guarantee depend on prompt-following rather than on what the model
physically has access to. Passing only topic labels, counts and booleans makes the failure mode
bounded: the model can rearrange known facts into prose, or violate the banned-phrase list
(caught and discarded, AC-5) — it cannot introduce a reference, a quote, or a topic that isn't
in `DossierFacts` because it was never given one. [Source: ARCHITECTURE-SPINE.md#AD-8 "hallucination is
guarded by field validation + low-confidence human review"]

### Reuse — what already exists and must not be rebuilt

- `buildCrossReferenceSummary`, `COVERAGE_TOPICS`, the cue lists, and their 12 existing test
  cases are **fully built and correct today** — the only defect is that they run in the wrong
  place (the browser, per-reference) rather than the right one (the Worker, per-shidduch). This
  story relocates; it does not redesign the algorithm.
- `reference_links_summary` (`03_views.sql:263-290`) already carries `shidduchim_id`,
  `call_status`, `what_they_said`, `conversation_log` and is already `security_invoker = on` —
  no view change is needed.
- The client-side upgrade-prompt pattern (`useAiEntitlement` → render `UpgradePrompt` vs. the
  real panel) already exists and is reused unchanged for AC-8's gating.

### Project Structure Notes

Moved: `workers/ai/dossierFacts.ts` (+test, from `references/crossReferenceSummary.ts`+test).
New: `workers/ai/dossierNarrator.ts` (+test). Touched: `workers/ai/index.ts` (+test),
`workers/ai/wrangler.toml`, `references/entitlementGate.guard.test.ts`, and 5.10's per-shidduch
diligence component (name unknown at story-write time — locate via `LSP findReferences` on
`useAiEntitlement` per AC-10/Task 4).

### Testing standard

AAA, no shared mutable state (`.claude/rules/testing.md`). No test makes a live Anthropic/AI
Gateway network call — `DossierNarrator` is mocked exactly as `ResumeExtractor` is in 11.2.
Carry the moved test file's existing fixtures forward verbatim (Task 1) rather than
re-authoring them — they already cover consensus, contradiction and gap cases correctly.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-11.3]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-13, #Non-goals "not a matchmaking
  product"]
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-7, #AD-8]
- [Source: 11-1-server-side-entitlement-on-inference.md — the gate, context values and
  `callAiWorker` this story depends on]
- [Source: supabase/schemas/03_views.sql:257-290 — `reference_links_summary`]
- [Source: supabase/tests/references_entity.sql:370-379 — the existing cross-account RLS
  coverage this story relies on and must not duplicate]
- [Source: src/components/atomic-crm/references/crossReferenceSummary.ts,
  ResearchAssistantPanel.tsx, useAiEntitlement.ts, entitlementGate.guard.test.ts — the code this
  story relocates/adapts]
- [Source: mockup/MyShadchan.dc.html:704-716 — the "Cross-reference summary" dossier card this
  story implements the server side of]
- [Source: design-artifacts/gap-analysis-v3.md §4 "AI diligence dossier ... ❌ absent", §6, §7
  "AI diligence dossier | inference + the entitlement gate (built)"]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
