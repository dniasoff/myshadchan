# Story 5.12: Guided Call mode

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Placement — SETTLED 2026-07-30 (reconciliation pass)

This story was drafted as `12.4` by an author who could not see its four siblings. It has been
placed as **Story 5.12, inside Epic 5**, and the file renamed `5-12-guided-call-mode.md`.
The section *"Why this file is numbered 12.4"* below is the author's reasoning at writing time and
is kept as history; where it speculates about sibling numbering it is superseded by this block.

**Why Epic 5 and not a new epic.** The story itself named `5.12` as defensible, and every
scheduling fact points there: it hard-depends on **5.10** and **5.11**, it edits
`references/ReferenceCallLog.tsx` — a file 5.10 declares "unchanged", which is true of 5.10's diff
and not of the world after it — and it lives entirely inside `references/`. Filing it outside
Epic 5 would put it in a wave that does not hold the leases on its own files. It adds no `TabKey`
and touches no descriptor, so 5.11's AC-6 (`findPendingTabs(realRegistry)` equals `[]`) stays green
behind it. **Delivery order is binding: 5.10 → 5.11 → 5.12.**

Note that Epic 5 placement does **not** paywall it. The free ruling below stands and is
machine-enforced by AC-9.

### Cross-story reconciliation findings (from the same pass)

- **F5 — file contention with Story 12.4 (Stripe billing).** AC-9 appends `"GuidedCall"` to
  `FREE_FEATURES_THAT_MUST_NOT_GATE` (`references/entitlementGate.guard.test.ts:33-41`); Story 12.4
  updates the `ALLOWED` set in the same file (`:26-30`). Two adjacent arrays, one file, and neither
  author could see the other. **Not the same wave**; whichever lands second re-reads the file
  rather than reapplying a remembered diff.
- **F11 — this story makes an existing dead stub actively misleading.**
  `layout/MobileNavigation.tsx:184-186` renders `Log a call (coming soon)`. Once Call mode exists,
  that stub reads as its entry point — and 5.11 AC-5 forbids a second call-log entry point, so it
  must be **deleted, not wired**. This story correctly disclaims ownership of it; the deletion is
  gap **D6**, recorded in `epics.md` under Story 5.12 as a delivery note. Confirm it is gone before
  closing 5.12.
- **F13 — the 5.11 boundary was independently verified and holds.** 5.11 owns
  `CallCaptureSheet.tsx` and this story never imports or edits it; both read
  `relationshipQuestions.ts` and neither restructures it; both call
  `dataProvider.logReferenceCall` at the same 4-arg signature.
- **F14 — `registry.json` and both i18n catalogues are contended** with 5.1, 5.2, 5.9, 5.10 and
  with Stories 12.1-12.4. A lease matter, not a design conflict.

## Story

As a parent on the phone to a reference,
I want the questions for this person to come one at a time, with what I type going straight onto
the conversation this call belongs to,
so that I get through the call without losing my place and without writing it up afterwards from
memory.

## Why this file is numbered 12.4, and what a placement agent should do with it

This story is one of four **adopted orphans** from the mobile gap analysis: gaps present in the
mockups, absent from the app, owned by no story in Epics 1-11. They are new work outside the
original numbering, and four independent authors are writing them at the same time.

**Identifier scheme:** epic `12` (provisional — "adopted mobile-gap work"), story number carried
over from the gap analysis's own ID. This one is **D4**, so `12.4`. The scheme is collision-free
by construction: the D-numbers are already unique and already agreed, so no two authors can claim
the same slot without coordinating.

**If the placement agent prefers a different home,** two are defensible and one is not:

- **`5.12` is fine.** This story adds no tab key, touches no `entityDescriptor`, and leaves
  `pendingTabs` alone, so 5.11's AC-6 (`findPendingTabs(realRegistry)` equals `[]`) stays green
  behind it. 5.11's "must be last" constraint is about the AD-24 flip, not about the epic being
  sealed.
- **`11.4` is fine for the *coaching* half only** — see "The paywall ruling" below.
- **Moving the whole story into Epic 11 is not fine.** Epic 11 is entitlement-gated by
  construction (11.1 puts `requireAiEntitlement` on the Worker); the flow specified here makes
  zero inference calls and must ship free. Putting it in Epic 11 would paywall it by filing.

## The boundary with 5.11 — read 5.11 before this, and read this section before writing code

The 3.2 / 3.12 failure was two stories owning one mechanism incompatibly. The mechanism at risk
here is call capture, and there are exactly three shared pieces. This is the whole boundary:

| Piece | Owner | This story |
|---|---|---|
| `references/relationshipQuestions.ts` (the question corpus, `getQuestionsForRelationship`) | pre-existing; 5.11 is its second consumer | **Reads it. Does not edit it.** Not one character — its test (`relationshipQuestions.test.ts:79-88`) flatMaps `set.questions` and calls `.toLowerCase()` on each element, so any change to the element type breaks 5.11's surface and the FR63 guard together. |
| `references/CallCaptureSheet.tsx` (the manual four-chip sheet) | **5.11** | **Never imported, never edited.** 5.11 AC-5 pins `grep -rn "CallCaptureSheet" src/ --include='*.tsx' \| grep import` to exactly one hit (`ReferenceCallLog.tsx`). This story keeps that grep at one hit and re-asserts it (AC-8). |
| `dataProvider.logReferenceCall` → `log_reference_call` | pre-existing, unchanged since Epic-3 era | **Second call site, same method, same RPC, same append-only log.** Not a second data path — the RPC's own doc comment (`02_functions.sql:2284-2287`) says both the capture screen and the guided script come through it. |

**What 5.11 delivers:** the four-chip *manual* capture sheet gains a read-only, collapsible list
of the tailored questions for that relationship, un-paywalled. One screen, all questions visible
at once, one free-text box, one save. It is a *reference card beside a notes field*.

**What this story adds:** a *session*. One question at a time at reading distance, an answer field
under it, **each answer saved to the server the moment you tap next**, a coverage checklist you can
see your position in, a next-three preview, and a pre-call brief built from your prior
conversations with this same person about other shidduchim. It is a *flow with a cursor and
server-side persistence*, which the 5.11 sheet is not and should not become.

**Does it belong inside 5.11 instead?** No, and the reason is specific rather than aesthetic.
5.11 is deliberately a verification-and-one-gap story whose central AC is that its diff touches
neither `handleSave` nor the RPC (its AC-3's "failing looks like" is *the diff touching
`CallCaptureSheet.tsx:46-59`*). Per-question incremental saving is exactly a change to that save
behaviour. Folding this in would make 5.11 assert one thing in AC-3 and do the opposite in a new
AC, in the file it is pinning. It is genuinely a second surface: separate component, separate save
cadence, separate entry point, sharing only the question corpus and the one write path — which is
the correct amount of sharing.

**Sequencing:** this story runs **after 5.10 and after 5.11**. After 5.10 because it mounts inside
the migrated Reference 360's `conversations` tab and depends on `references/repeatRecognition.ts`,
which 5.10 Task 1 creates. After 5.11 because 5.11 owns the "tailored questions are not paywalled"
ruling and the guard-test posture this story extends.

## Where it lives, and why it always has a shidduch

RULING 7 (R7): references are shidduch-scoped, reached only from a shidduch's Diligence tab, no
browse surface. A reference is therefore never open in isolation — and more usefully, the thing
being called about is never ambiguous: `ReferenceCallLog.tsx` renders **one card per
`reference_links` row**, i.e. one card per (reference × shidduch) conversation, each already
carrying `shidduchim_id`, `shidduch_name_en`, `effective_relationship` and the full
`conversation_log` for that pairing (`ReferenceCallLog.tsx:23-120`).

So the guided session's unit is the **link**, not the reference. It launches from that card, it
knows which shidduch the call is about without asking, and it writes back to that link's log. No
picker, no context inference, no new query for the shidduch.

**Not an entry point, and must not become one:** the (+) capture sheet's `Log a call (coming
soon)` stub (`layout/MobileNavigation.tsx`). A global "log a call" control has no shidduch and no
link, so under R7 it cannot resolve one. The gap analysis recommends deleting that stub; this
story neither deletes it nor adopts it, and a builder must not wire Call mode into it.

## The paywall ruling this story makes

The PRD files FR60 ("guided call script / checklist with inline capture", `prd.md:420`) under §14,
headed *"Paid AI feature"* (`prd.md:412-416`). Three things contradict a blanket reading of that
heading — the first of them being §14's own qualifying sentence:

1. `prd.md:414-416` immediately narrows the heading: *"Core reference tracking (§8) — call-status,
   what-they-said, conversation logs — stays **free**; **only the AI assistance is gated**."*
   Everything this story writes is call-status, what-they-said and conversation-log content.
2. `relationshipQuestions.ts:1-12` says outright: *"the paid assistant (FR60) uses them as the
   spine of its guided script, but they work without it, **which is why the call script itself is
   never behind the paywall**."*
3. The E4 billing invariant is that **AI is the only paid surface** — server-authoritative, via
   `ai_entitlement()`. The flow specified here issues **zero inference calls**. Static question
   text, an index, and an existing RPC are not AI, and gating them would paywall a checklist.

**Ruling: the deterministic flow ships free.** What stays paid, and stays in Epic 11, is the
*coaching* half of FR60 that the mockup renders beside the script — the per-question "why I am
asking this" rationale derived from this reference's own prior answers (`refCoaching()`,
`MyShadchan.dc.html:1427-1442`) and adaptive next-question selection. Those are generated prose
and belong behind the gate.

**The reversal path, stated so the ruling is cheap to overturn:** if the owner rules FR60 paid in
full, the change is two lines — add `GuidedCallSession.tsx` to `entitlementGate.guard.test.ts`'s
`ALLOWED` set and remove `"GuidedCall"` from the `FREE_FEATURES_THAT_MUST_NOT_GATE` list this
story adds (AC-9). Nothing else in the design assumes free.

## Decided at planning time: no schema change, no migration, no migration lease

The tempting change is a fifth parameter on `log_reference_call` — `p_topic text default null` —
so each saved answer records *which* question it answers and the coverage checklist becomes a
durable server-side fact instead of client state. **Rejected**, and it is worth writing down why,
because the cost is not obvious and the next author will reach for it too:

- `CREATE OR REPLACE FUNCTION` with a different argument list creates an **overload**, not a
  replacement. Both `log_reference_call(bigint,text,text,text)` and the 5-arg form would then
  exist, and PostgREST resolves RPCs by named-argument set — a 4-arg call becomes ambiguous
  (`PGRST203`) and **every** call fails, including the plain "Log a call" the manual sheet makes.
  The migration would have to `DROP FUNCTION` the old signature explicitly; `db diff` cannot be
  trusted to emit that.
- `supabase/schemas/06_grants.sql:551-553` names the 4-arg signature three times. It must change
  in the same edit, and the generated migration must carry the `revoke`/`grant` pair by hand — a
  fresh `CREATE FUNCTION` is `EXECUTE` to `PUBLIC` by default.
- `types.ts#ConversationLogEntry` and `#LogReferenceCallInput`, both provider implementations
  (`providers/supabase/dataProvider.ts:306-323` and
  `providers/fakerest/internal/referenceLinks.ts:113-170`), and `supabase/tests/references_entity.sql`
  all move with it — `types.ts` and `supabase/**` being precisely the files Epic 5's live agents
  hold leases on.
- And it buys durability this story does not need: the step cursor is meaningful for the duration
  of one call, and the *answers* are already durable the moment each one is saved.

**Consequence, stated so the wave planner can use it: this story is schema-free.** It needs no
`supabase/**` edit, no migration, no migration lease, and no `npm run test:unit:db` run. If a
generated migration appears in this story's diff, something went wrong.

The cursor lives in the URL instead (`?call=<link id>&step=<n>`), which is where
`.claude/rules/web-patterns.md` ("URL as state") puts it anyway, and which survives a reload — the
normal interruption on a phone, where the dialer backgrounds the browser. It does **not** survive
the tab being killed cold; that costs the user their place in the checklist, never a single
answer, and AC-6 makes that failure mode explicit rather than silent.

**Also rejected: buffering the session in `localStorage`.** It would survive a cold kill, but it
would put candid reference testimony in unencrypted device storage outside RLS, on a phone that is
frequently shared inside a household. Trading a recoverable UX annoyance for that is the wrong
trade in this product.

## Everything the flow needs already exists

A grep-first pass before writing this found the plumbing built and, in two places, **built and
unreachable**:

- `supabase/schemas/02_functions.sql:2288-2360` — `log_reference_call` already accepts
  `p_source in ('manual','assistant')` (`:2318-2320`), stamps `source` into each appended
  `conversation_log` entry (`:2332-2338`), and inserts the `call_logged` interaction with
  `scope = 'shidduch'` (`:2346-2356`). Its own header comment names the guided script as its second
  caller.
- `types.ts:450` — `/** "manual" = the capture screen, "assistant" = the guided call script. */`
- `CallCaptureSheet.tsx:34` — a `source?: "manual" | "assistant"` prop that no caller has ever
  passed as `"assistant"`.
- `ReferenceCallLog.tsx:83-87` — renders `· via the call script` for any log entry whose
  `source === "assistant"`. **`grep -rn '"assistant"' src/ --include='*.ts*'` shows nothing in the
  tree writes that value**, so this branch and its i18n key
  (`crm.references.callLog.viaAssistant`) are dead today. This story is what makes them reachable.
- `crm.references.call.onACall` — `"On a call"` / `"En appel"`, present in **both** catalogues
  (`englishCrmMessages.ts:636`, `frenchCrmMessages.ts:574`), referenced by no component. Reuse it
  for the session header rather than adding a synonym.
- `references/useReferenceLinks.ts:19-31` — every link this reference has, account-scoped by RLS.
- `references/repeatRecognition.ts#countOtherConversations` — created by **5.10 Task 1**. Verify it
  exists before starting; if 5.10 has not landed as specified, stop and report rather than
  re-extracting the predicate from `RepeatRecognitionPanel.tsx:53-56`.

## Acceptance Criteria

1. **Given** the Reference 360's `conversations` tab (post-5.10), **when** a link card renders,
   **then** it carries a second control, **"Call mode"**, beside the existing "Log a call"
   (`ReferenceCallLog.tsx:99-110`), and activating it sets `?call=<link.id>&step=1` on the current
   location via `useSearchParams` from `react-router` — never by writing `window.location`.
   Reloading that URL re-opens the session at the same step.
   **Failing looks like:** the session opens but the address bar is unchanged, so a reload lands
   back on the tab with the session gone; or the component reads `window.location.search`, which
   under the app's `HashRouter` is **always empty** — the exact defect
   `references/ReferenceCreate.test.tsx:26-38` documents, where a test that drove
   `window.history.pushState` agreed with the bug while every real user hit the broken path. Drive
   `TestMemoryRouter`'s `initialEntries`, never `pushState`.

2. **Given** a session for a link, **when** it opens, **then** the script is
   `getQuestionsForRelationship(link.effective_relationship).questions`, in order, one step per
   question, with the relationship-specific set first and the universal questions last — the same
   corpus 5.11 shows in the manual sheet, reached through the same function, with **no second
   question corpus anywhere in the diff**.
   **Failing looks like:** `references/callScript.ts` contains question text of its own; or a
   reference whose `effective_relationship` is `null` opens a session with zero steps instead of
   the three universal questions.

3. **Given** a step with text in the answer field, **when** I advance, **then** that answer is
   written **immediately** with a single
   `dataProvider.logReferenceCall({ reference_link_id, what_they_said, source: "assistant", call_status })`,
   the cursor advances only after the write resolves, and a failed write leaves the cursor where it
   is with the typed text still in the field and a visible error. `call_status` is `"answered"` on
   the first saved answer of the session and omitted thereafter.
   **Failing looks like:** answers accumulate in React state and are flushed in one call at the
   end (kill the tab at step 4 of 7 and three answers are gone); or `logReferenceCall` rejects and
   the UI advances anyway, silently discarding what was typed; or a saved entry's `source` reads
   `"manual"`, leaving `ReferenceCallLog.tsx:85`'s "via the call script" branch still unreachable.

4. **Given** an empty answer field, **when** I advance, **then** the step is skipped with **no**
   write — an unanswered question must not append an empty `conversation_log` entry, and must not
   count as covered.
   **Failing looks like:** walking a 7-step script pressing next 7 times without typing produces 7
   `conversation_log` entries, or moves the coverage counter to `7 of 7`.

5. **Given** a session in progress, **when** it renders, **then** it shows (a) a coverage line
   `"%{done} of %{total} covered"` and a progress bar, (b) the full step list with a done marker
   per answered step, each row the question text clamped to one line and tappable to jump to that
   step, and (c) a **next-three** preview of the upcoming questions. `done` counts only steps
   answered in this session per AC-3/AC-4.
   **Failing looks like:** the coverage count is derived from `link.conversation_log.length`, so
   an earlier call's entries make a fresh session start at "4 of 7 covered".
   **Deliberate deviation from the mockup, not an omission:** the mockup gives each of its ten
   steps a hand-written short label (`callScript()`, `MyShadchan.dc.html:1444-1456` — "Middos",
   "Health", …). Those labels were authored for one fictional reference and would become a second,
   unmaintained copy of the question corpus (DRY, NFR-14). The checklist shows the question itself,
   clamped. Do not add a label table.

6. **Given** a link that already has `conversation_log` entries when a session opens, **then** the
   session states how many answers are already on this conversation and starts a **new** pass at
   step 1 — it never renumbers, re-writes or de-duplicates existing entries, and the checklist
   starts empty.
   **Failing looks like:** the session tries to reconstruct which questions a previous call
   answered (it cannot — nothing persists a step id, by the decision above) and pre-ticks the
   checklist by guessing; or opening Call mode a second time mutates or hides earlier entries.
   The log is append-only in the RPC (`02_functions.sql:2343`), and it stays that way.

7. **Given** a reference I have spoken to about other shidduchim, **when** a session opens,
   **then** a pre-call brief precedes step 1: the count and destinations of those other
   conversations, computed with **`countOtherConversations(links, link.shidduchim_id)`** (5.10's
   shared helper) over `useReferenceLinks(link.reference_id)` and excluding the current shidduch;
   and the universal *"How long have you known them, and in what setting?"* step is marked as
   already asked, with a one-tap skip.
   **Given** a reference with no other conversations, **then** there is no brief and no marker.
   **Failing looks like:** the brief re-implements the filter instead of calling the helper
   (`grep -n "shidduchim_id !==" src/components/atomic-crm/references/` returns a hit outside
   `repeatRecognition.ts`); or the brief counts the **current** shidduch, so a reference linked to
   exactly one shidduch — this one — is announced as a repeat; or the brief renders its "no other
   conversations" copy while `useReferenceLinks` is still pending, which is the regression
   `RepeatRecognitionPanel.tsx:24-33` already documents having shipped once.

8. **Given** this story's diff, **when** the 5.11 invariant is re-run, **then**
   `grep -rn "CallCaptureSheet" src/ --include='*.tsx' | grep import` still returns **exactly one**
   hit — `references/ReferenceCallLog.tsx`. Call mode does not import, wrap, re-export or subclass
   `CallCaptureSheet`, and `CallCaptureSheet.tsx` is unmodified by this story.
   **Failing looks like:** the grep returns two hits, or `git diff --stat` lists
   `references/CallCaptureSheet.tsx`.

9. **Given** the free-forever ruling above, **when** the entitlement guard runs, **then**
   `references/entitlementGate.guard.test.ts`'s `FREE_FEATURES_THAT_MUST_NOT_GATE` array
   (`:34-42`) contains `"GuidedCall"`, and the guard passes — no file whose path contains
   `GuidedCall` references `useAiEntitlement`. The `ALLOWED` set (`:26-30`) is **not** extended.
   **Failing looks like:** the array is unchanged, so a later story can gate Call mode without any
   test going red — which is how this ruling would quietly evaporate.

10. **Given** UX-DR3 (records live at URLs, not modals; AD-24), **when** the session renders,
    **then** it is a bottom `Sheet` (`@/components/ui/sheet`), never a `Dialog`, and
    `misc/recordSurfaceDialogs.guard.test.ts` stays green with **no new entry** in its `ALLOWED`
    set (`:45-50`) — the guard scans `references/` for `@/components/ui/dialog` imports
    (`:28-40`).
    **Failing looks like:** `GuidedCallSession.tsx` imports `@/components/ui/dialog`, and the fix
    is proposed as an allowlist entry rather than a `Sheet`.

11. **Given** a 390 × 844 viewport (the phone this is used on), **when** a session renders at any
    step, **then**: the question text computes to **at least 20px**; every interactive control has
    a hit box of **at least 44 × 44 CSS px**; the primary advance control is bottom-anchored and
    its `getBoundingClientRect().bottom` is within the viewport **without scrolling**; and the
    session's own scroll container satisfies `scrollWidth <= clientWidth`.
    **Failing looks like — and this is the assertion to get right:** testing only that the *page
    root* has no horizontal overflow. Story 3.1's shell AC asserts exactly that, and an
    internally-scrolling child passes it — which is why the Reference 360's Assistant tab has been
    clipped off the right edge at 390px in both builds while its test stayed green (gap D5). Assert
    on the **session's own** scroll container and on the question card's and the advance control's
    bounding rects, not on the root.

12. **Given** the session's write path, **when** anything is saved, **then** it goes through
    `dataProvider.logReferenceCall` and nothing else: no direct `update("reference_links", …)`, no
    `create("interactions", …)`, no second RPC. The `call_logged` interaction on the shidduch's
    Activity tab is produced by the existing RPC, not by this story.
    **Failing looks like:** `grep -rn "reference_links\|interactions" src/components/atomic-crm/references/GuidedCallSession.tsx src/components/atomic-crm/references/useCallSession.ts`
    returns a `dataProvider.update` or `dataProvider.create` call.

13. **Given** the wrap-up after the last step, **when** it renders, **then** it offers exactly two
    actions: **End call** (closes the session, clears the search params) and **Not finished — call
    back** (one `logReferenceCall` with `call_status: "call_back"` and no text, then closes). It
    does **not** re-render the four-chip status grid.
    **Failing looks like:** the wrap-up copies `CallCaptureSheet.tsx:101-132`'s chip grid, creating
    a second implementation of the status vocabulary — the duplication
    `.claude/rules/coding-style.md` (DRY) and NFR-14 both forbid. If a full status change is
    wanted, the manual sheet on the same card already does it.

14. **Given** FR63, **when** the session renders, **then** it carries the guardrail line ("Call
    mode helps you not miss a question; it never judges whether this is a good match") and emits no
    verdict, score or recommendation anywhere. `references/callScript.ts` is pure and deterministic
    — same link in, same script out — and makes no network call.
    **Failing looks like:** the session composes a closing summary sentence of its own (the
    mockup's `sendCall` wrap-up text is model-flavoured prose — do not port it), or `callScript.ts`
    imports `useAiEntitlement`, `callAiWorker` or a data provider.

## Tasks / Subtasks

- [x] **Task 0 — Verify the world this story is written against** (prerequisite)
  - [x] `references/ReferenceShow.tsx`'s bespoke `<Tabs>` block is gone and the reference renders
        on `Entity360` with a `conversations` tab (5.10 AC-4). If not, **stop** — the entry point
        has no host yet.
  - [x] `references/repeatRecognition.ts` exports `countOtherConversations` (5.10 Task 1). If not,
        stop and report; do not re-extract the predicate.
  - [x] `CallCaptureSheet.tsx` renders the tailored questions with no `useAiEntitlement` import
        (5.11 AC-1). If not, 5.11 has not landed and the paywall boundary this story assumes is
        not yet in force.
  - [x] `grep -rn '"assistant"' src/ --include='*.ts*' | grep -v test` still shows **no writer** of
        that source value. If some other story has since written one, re-verify AC-3 before
        assuming it is this story's to introduce.
  - [x] Confirm `log_reference_call`'s signature is still `(bigint, text, text, text)` in
        `06_grants.sql:551-553`. If a fifth parameter has appeared, the "schema-free" decision
        above needs revisiting before Task 3.

- [x] **Task 1 — The script** (AC: 2, 14)
  - [x] New `references/callScript.ts`: `buildCallScript(relationship?: string | null):
        CallScriptStep[]`, where `CallScriptStep = { id: string; question: string }` and `id` is a
        deterministic `` `${set?.id ?? "universal"}.${index}` ``. It calls
        `getQuestionsForRelationship` and maps — **it defines no question text**. Pure, no imports
        beyond `./relationshipQuestions`.
  - [x] The ids are session-scoped by design (nothing persists them), so they need no stability
        guarantee across releases. Say so in the module's doc comment, or the next author will add
        a migration to store them.
  - [x] New `references/callScript.test.ts`: relationship-specific set comes first and universal
        last; a blank/unrecognised relationship yields exactly the three universal steps; ids are
        unique within a script; the function is referentially stable for the same input. **Reuse
        `relationshipQuestions.test.ts`'s existing relationship fixtures** ("seminary teacher",
        "CHAVRUSA", "dog walker", `""`) — do not invent new relationship strings.

- [x] **Task 2 — The cursor** (AC: 1, 6)
  - [x] New `references/useCallSession.ts`: reads/writes `?call=<link id>&step=<n>` with
        `useSearchParams` from `react-router` (the hash-aware path —
        `ReferenceCreate.tsx:118-126` is the worked precedent and the bug it fixed); exposes
        `{ activeLinkId, step, open(linkId), goTo(step), close() }`. `close()` removes **both**
        params. Out-of-range or non-numeric `step` clamps to 1 rather than throwing.
  - [x] New `references/useCallSession.test.tsx` — drive `TestMemoryRouter`'s `initialEntries`.
        Cases: `?call=7&step=3` restores step 3; `?call=7&step=99` on a 7-step script clamps;
        `?call=abc` opens nothing; `close()` leaves the pathname untouched and both params gone.

- [ ] **Task 3 — The session surface** (AC: 3, 4, 5, 10, 11, 12, 13, 14)
  - [ ] New `references/GuidedCallSession.tsx`: a `Sheet side="bottom"` following
        `CallCaptureSheet.tsx:77-83`'s idiom (`max-h-[92vh] overflow-y-auto`, glass tokens) —
        **`@/components/ui/sheet`, never `@/components/ui/dialog`** (AC-10). Regions, top to
        bottom: `crm.references.call.onACall` header with the reference name and the shidduch this
        call is about (`link.shidduch_name_en`); the coverage line + bar + step list; the current
        question card (`text-xl` minimum) with an "Ask them" eyebrow; the answer `Textarea`; the
        next-three preview; a bottom-anchored **Save and next** (`min-h-[48px] w-full`, matching
        `CallCaptureSheet.tsx:153-168`); the FR63 guardrail line.
  - [ ] Advance handler: empty field ⇒ skip with no write (AC-4); non-empty ⇒ `await
        dataProvider.logReferenceCall({ reference_link_id: link.id, what_they_said: text.trim(),
        source: "assistant", call_status: isFirstSaveOfSession ? "answered" : undefined })`, then
        advance; on rejection keep the cursor and the text and `notify(..., { type: "error" })`
        (`CallCaptureSheet.tsx:64-68` is the shape). `refresh()` once, on close — not per step;
        refetching the whole tab between questions is a visible stall mid-call.
  - [ ] Wrap-up: **End call** and **Not finished — call back** only (AC-13). No chip grid.
  - [ ] File-size discipline (`.claude/rules/coding-style.md`): if the component approaches ~250
        lines, extract the checklist rail as `references/CallCoverageList.tsx` rather than growing
        the file. Declare it in the File List if you do.

- [ ] **Task 4 — Entry point and pre-call brief** (AC: 1, 7, 8)
  - [ ] `references/ReferenceCallLog.tsx`: add the **Call mode** button beside "Log a call" in
        `LinkCard`'s action row (`:98-110`), calling `open(link.id)`. Mount `GuidedCallSession`
        for the card whose id matches `activeLinkId`. **Do not touch the existing
        `CallCaptureSheet` mount at `:112-116`** — both entry points stay, they are different
        jobs.
  - [ ] Pre-call brief inside the session: `useReferenceLinks(link.reference_id)` +
        `countOtherConversations(links, link.shidduchim_id)`. Render nothing when the count is 0.
        Render the pending skeleton, not the empty copy, while `isPending` — see
        `RepeatRecognitionPanel.tsx:24-33` for why this specific regression is called out.
  - [ ] Mark the universal "How long have you known them" step as already-asked when the count is
        > 0, with a skip control. Match the step by **id** (`universal.<n>` from Task 1), never by
        substring-matching the question text.

- [ ] **Task 5 — i18n, both catalogues** (AC: 5, 13, 14)
  - [ ] Add a `crm.references.callMode.*` block to **both**
        `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts`: `launch`, `coverage`
        (`"%{done} of %{total} covered"`), `askThem`, `comingUp`, `answerPlaceholder`, `saveNext`,
        `skip`, `askedBefore`, `alreadyLogged` (`smart_count`), `wrapTitle`, `callBack`, `end`,
        `guardrail`.
  - [ ] **Reuse, do not duplicate:** `crm.references.call.onACall` (already in both catalogues,
        currently referenced by nothing) for the header, and `crm.references.repeat.title` /
        `.progress` for the pre-call brief.
  - [ ] Both catalogues or neither. `i18nProvider` runs `allowMissing: true`, so a missing French
        key falls back to English **silently** and there is no parity test to catch it. This is
        the same trap 5.11 Task 2 records.

- [ ] **Task 6 — Guard tests** (AC: 8, 9, 10)
  - [ ] `references/entitlementGate.guard.test.ts`: add `"GuidedCall"` to
        `FREE_FEATURES_THAT_MUST_NOT_GATE` (`:34-42`). Do not touch `ALLOWED`.
  - [ ] Re-run `misc/recordSurfaceDialogs.guard.test.ts` — must pass with no new exemption.
  - [ ] New `references/callModeBoundary.guard.test.ts` (or an added case in an existing
        `references/` guard): assert with the repo's `import.meta.glob(..., { query: "?raw" })`
        idiom that exactly one non-test module in `src/` imports `CallCaptureSheet`, and that no
        module whose basename starts with `GuidedCall` or `useCallSession` imports it. This is
        AC-8 made mechanical so 5.11's invariant survives the next author too.

- [ ] **Task 7 — Tests** (AC: all)
  - [ ] Component tests run in **real Chromium via `vitest-browser-react`**, with
        `TestMemoryRouter` and `CoreAdminContext` — see `references/ReferenceCreate.test.tsx:1-70`
        for the exact shape. **React Testing Library is not a dependency of this repo**; do not
        `import { render } from "@testing-library/react"`.
  - [ ] Viewport assertions (AC-11) follow `entity360/Entity360.responsive.test.tsx:1-60`: import
        `@/index.css` (geometry assertions are meaningless without the real stylesheet), call
        `await page.viewport(390, 844)` from `@vitest/browser/context`, and **restore the default
        viewport in `afterEach`** — that file's own `DEFAULT_VIEWPORT` comment explains why
        (`.claude/rules/testing.md`, test isolation).
  - [ ] Save-path tests use a `vi.fn()` `logReferenceCall` on a stub `CrmDataProvider`
        (`ReferenceCreate.test.tsx:39-55` is the builder shape) and assert the **exact argument
        object**, including `source: "assistant"` — a test that only asserts "was called" cannot
        distinguish this story's write from the manual sheet's.
  - [ ] Must stay green untouched: `references/relationshipQuestions.test.ts`,
        `references/RepeatRecognitionPanel.test.tsx`,
        `providers/fakerest/dataProvider.referenceMatch.test.ts` (its `logReferenceCall` block at
        `:142-185`), and the whole `entity360` suite.
  - [ ] **No `npm run test:unit:db` run** — this story is schema-free (see the decision above).
  - [ ] `make typecheck && npm run lint && make test`, then `npm run build`.

- [ ] **Task 8 — E2E** (AC: 1, 3, 5)
  - [ ] New `e2e/guided-call.spec.ts`, green on **both** Playwright projects (`chromium` and
        `Mobile Chrome`, `playwright.config.ts:145-160`). Seed through the sanctioned path the way
        `e2e/references-scoping.spec.ts` does — open a shidduch, add a reference — then: open the
        reference, go to `conversations`, press **Call mode**, assert the URL carries
        `call=` and `step=1`, type an answer, advance, and assert **both** that the coverage line
        reads `1 of N covered` **and** that a `reference_links` row's `conversation_log` contains
        an entry with `source = "assistant"` (query it with the admin client, as
        `references-scoping.spec.ts` already does for link existence). Asserting only the UI
        would pass over a client-side-only save.
  - [ ] Reload mid-session and assert the step is preserved (AC-1).
  - [ ] No `waitForTimeout` anywhere (`.claude/rules/testing.md`).

## Dev Notes

### The one-handed constraint is not decoration

The mockup's Call mode is a desktop layout: a 236px fixed coverage sidebar beside a chat column
(`MyShadchan.dc.html:1309-1370`). On the device this feature is actually for, that sidebar is
half the screen. The translation is: coverage collapses to a line plus a bar plus an expandable
list; the question card and the answer field own the viewport; the advance control is
bottom-anchored under the thumb. The mockup's 20px question type is the one measurement worth
porting literally — it is sized to be read at arm's length while the phone is on speaker, and
AC-11 pins it.

The same constraint is why AC-3 saves per answer rather than at the end. Making a call and using
the app on one device means the browser is backgrounded for the whole call; a session that only
persists on "End call" persists nothing on the phone it was designed for.

### Why the entry point is the link card and not a tab

Adding a `call` tab to the reference's tab set would fail the build, and it is worth knowing why
before someone tries: `TabKey` is a closed union (`entity360/tabKeys.ts`), and AD-24's validator
asserts `keys(tabs) ∪ pendingTabs` equals `CANONICAL_TAB_SETS.references` **as sets** — rule (d)
at `entity360/ad24Conformance.ts:572`, against the seven-key `references` row at `:241-249` — a
key in neither is a missing tab, a key in both is
`tab-key-duplicated`, and a key outside the union does not typecheck. This story deliberately adds
**no** tab, touches **no** descriptor, and therefore cannot disturb 5.11's AC-6 flip.

### Coverage here is not FR61 coverage — do not merge them

`references/crossReferenceSummary.ts`'s `COVERAGE_TOPICS` (`:30-77`) is a different thing with a
confusingly similar name: it infers, by cue-matching free text (`:126-134`), which of six topics
have been touched **across every reference on a shidduch**. That is FR61, it is per-shidduch, and
**Story 11.3 moves the whole module to `workers/ai/dossierFacts.ts`**. This story's checklist is
per-call coverage of the questions *this* script intends to ask. Do not extend `COVERAGE_TOPICS`
to fit the script, do not import it, do not edit it — a story that edits it creates a merge
conflict with 11.3's `git mv` for no benefit.

### The dead `"assistant"` branch is the acceptance signal

`ReferenceCallLog.tsx:83-87` has rendered `· via the call script` for `source === "assistant"`
entries since before this story existed, and nothing has ever written one. When this story is
done, walking a script and then expanding the link card's log `<details>` shows that suffix on
every answer. That is a one-glance manual check that the write actually took the intended path,
and it needs no new UI.

### Project Structure Notes

**The exact file set. Every declared set in this project has so far been too small, so this lists
the ones that get missed by name — including the ones that are deliberately absent.**

*New source (3-4 files — all mutate `registry.json`):*
- `src/components/atomic-crm/references/callScript.ts`
- `src/components/atomic-crm/references/useCallSession.ts`
- `src/components/atomic-crm/references/GuidedCallSession.tsx`
- `src/components/atomic-crm/references/CallCoverageList.tsx` *(only if Task 3's extraction
  triggers)*

*New tests (do **not** touch `registry.json` — `scripts/generate-registry.mjs:29-30` ignores
`**/*.{test,spec}.*`):*
- `references/callScript.test.ts`
- `references/useCallSession.test.tsx`
- `references/GuidedCallSession.test.tsx` (includes the AC-11 viewport cases)
- `references/callModeBoundary.guard.test.ts`
- `e2e/guided-call.spec.ts`

*Modified:*
- `src/components/atomic-crm/references/ReferenceCallLog.tsx` — the Call mode button and the
  session mount. **Note for the wave planner: 5.10 AC-4 declares this file "unchanged"; that is
  true of 5.10's diff, not of the world afterwards. This story must land after 5.10, not beside
  it.**
- `src/components/atomic-crm/references/entitlementGate.guard.test.ts` — one array entry (AC-9).
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
  — **both catalogues are contended**: 5.1, 5.2 and 5.10 all write them. Take the lease, and
  verify rather than re-edit if a sibling has already landed nearby.
- `registry.json` — the new non-test source modules change what
  `scripts/generate-registry.mjs` globs, so it must be regenerated with `make registry-gen`.
  **Do not assume the pre-commit hook does it for you:** `.husky/pre-commit` deliberately
  *skips* `make registry-gen` whenever any untracked or worktree-deleted file exists under
  `src/components/atomic-crm`, `src/components/supabase`, `src/hooks` or `src/lib` — i.e. on
  exactly the busy tree this story lands on — and prints a message saying so. On a busy tree the
  wave's single committer regenerates it on a quiet tree. Declare it either way.

*Deliberately NOT in the set — named so a reviewer can confirm the absence is a decision:*
- `supabase/**` — no migration, no `02_functions.sql`, no `06_grants.sql`, no
  `supabase/tests/**`. Schema-free by the decision above. `.claude/rules/security-triggers.md`
  therefore does **not** fire for RLS/migration/storage on this story; it *does* still fire for
  "user input handling" (the answer field) and "database queries" (the RPC call site) — dispatch
  SECURITY-REVIEWER anyway, the false positive is cheap.
- `src/components/atomic-crm/types.ts` — no new persisted shape.
  `LogReferenceCallInput.source` (`types.ts:667-672`) already admits `"assistant"`.
- `references/entityDescriptor.ts`, `entity360/tabKeys.ts`, `entity360/ad24Conformance.ts`,
  `entity360/registry.stubs.test.ts` — no tab, no descriptor change.
- `references/index.ts` — no new route, no new resource prop.
- `references/CallCaptureSheet.tsx` (AC-8), `references/relationshipQuestions.ts`,
  `references/crossReferenceSummary.ts`, `references/callStatus.ts`,
  `providers/**/dataProvider*.ts` — all read, none written.
- `layout/MobileNavigation.tsx` — the `Log a call (coming soon)` stub is **not** this story's to
  adopt or delete.
- `misc/recordSurfaceDialogs.guard.test.ts` — must pass unchanged (AC-10); verify-only, not an
  edit.

### Dependencies

- **5.10** (hard): the `conversations` tab on the `Entity360` shell, and
  `references/repeatRecognition.ts#countOtherConversations`.
- **5.11** (hard): the free-questions ruling and the `CallCaptureSheet` single-invoker invariant
  this story preserves. Landing before 5.11 would make AC-8's grep meaningless and would leave the
  two surfaces disagreeing about whether questions are paywalled.
- **Epic 3** (already built): `RecordLink`, the universal tabs, `useTabLabel`.
- **Nothing in Epic 11.** The coaching layer is downstream of this story, not upstream of it.

### References

- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md:412-426] — §14,
  FR59-FR63. The paid heading and its own narrowing sentence (`:414-416`, "only the AI assistance
  is gated"), FR60 (`:420`) and FR63's hard invariant (`:425-426`) — the three clauses this
  story's paywall ruling reconciles against E4.
- [Source: _bmad-output/implementation-artifacts/5-11-call-logging-and-tailored-questions.md] —
  AC-1 (questions free, no `useAiEntitlement`), AC-3 (the save path is untouched by 5.11), AC-5
  (the single-invoker grep this story preserves), AC-6 (the AD-24 flip this story cannot disturb).
- [Source: _bmad-output/implementation-artifacts/5-10-reference-360-and-diligence.md] — AC-4 (the
  seven-tab reference 360, `conversations` = `RepeatRecognitionPanel` + `ReferenceCallLog`), Task 1
  (`countOtherConversations`).
- [Source: _bmad-output/implementation-artifacts/11-3-diligence-dossier.md] — AC-1 relocates
  `crossReferenceSummary.ts` to `workers/ai/dossierFacts.ts`; AC-8 keeps `CallCaptureSheet`
  gate-free. Why this story must not edit that module.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — binding: §3 the closed `TabKey`
  union and per-entity tab sets (why Call mode is not a tab), §0 validation commands and AD-23
  vocabulary.
- [Source: src/components/atomic-crm/references/relationshipQuestions.ts:1-12, :89-105] — the
  corpus, the "never behind the paywall" comment, and `getQuestionsForRelationship`'s
  universal-fallback behaviour AC-2 relies on.
- [Source: src/components/atomic-crm/references/relationshipQuestions.test.ts:79-88] — the FR63
  verdict-word guard that flatMaps `set.questions` as strings; why this story must not change that
  element type.
- [Source: src/components/atomic-crm/references/ReferenceCallLog.tsx:23-120] — `LinkCard`: the
  per-shidduch unit, the action row AC-1 extends (`:98-110`), the existing `CallCaptureSheet`
  mount (`:112-116`), and the dead `source === "assistant"` branch (`:83-87`).
- [Source: src/components/atomic-crm/references/CallCaptureSheet.tsx:25-35, :64-68, :77-83,
  :153-168] — the `source` prop that already admits `"assistant"`, the error-notify shape, the
  bottom-`Sheet` idiom and the thumb-sized primary action this story matches. Read only.
- [Source: supabase/schemas/02_functions.sql:2284-2360] — `log_reference_call`: the "one write
  path" comment naming the guided script, `p_source` validation (`:2318-2320`), the appended entry
  (`:2332-2338`), the append-only `||` (`:2343`), and the `call_logged` interaction insert
  (`:2346-2356`).
- [Source: supabase/schemas/06_grants.sql:551-553] — the 4-arg signature named three times; the
  cost centre behind the rejected `p_topic` parameter.
- [Source: src/components/atomic-crm/types.ts:446-453, :667-672] — `ConversationLogEntry` (whose
  own comment already reads *"assistant" = the guided call script*) and `LogReferenceCallInput`.
- [Source: src/components/atomic-crm/references/useReferenceLinks.ts:19-31] — the cross-shidduch
  query the pre-call brief uses; RLS-scoped, deliberately not filtered by single.
- [Source: src/components/atomic-crm/references/RepeatRecognitionPanel.tsx:24-33, :53-56] — the
  `isPending` regression AC-7 must not repeat, and the filter 5.10 extracts into
  `countOtherConversations`.
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:26-30, :34-42] — the
  `ALLOWED` set (untouched) and the `FREE_FEATURES_THAT_MUST_NOT_GATE` list AC-9 extends.
- [Source: src/components/atomic-crm/misc/recordSurfaceDialogs.guard.test.ts:28-40, :45-50] —
  UX-DR3's scan over `references/` and its allowlist, which AC-10 must not grow.
- [Source: src/components/atomic-crm/references/ReferenceCreate.tsx:116-126] — `useSearchParams`
  from `react-router` as the hash-aware way to read query state, and the HashRouter bug it fixed.
- [Source: src/components/atomic-crm/references/ReferenceCreate.test.tsx:1-70] — the
  `vitest-browser-react` + `TestMemoryRouter` + stub-`CrmDataProvider` test shape, and the
  "the test agreed with the bug" warning about `window.history.pushState`.
- [Source: src/components/atomic-crm/entity360/Entity360.responsive.test.tsx:1-60] — the
  `page.viewport` + `@/index.css` + `afterEach` restore idiom AC-11's tests follow.
- [Source: src/components/atomic-crm/providers/commons/englishCrmMessages.ts:629-645] and
  [frenchCrmMessages.ts:567-582] — the existing `crm.references.call.*` / `callLog.*` blocks,
  including the unused `onACall` key this story adopts and the `viaAssistant` key it makes
  reachable.
- [Source: mockup/MyShadchan.dc.html:1309-1370, :1444-1456, :1586-1606] — the Call mode overlay,
  its ten-step `callScript()` and its cursor/coverage state machine: the UI this story translates
  to a phone. `:1427-1442` (`refCoaching()`) is the generated-rationale layer this story
  deliberately leaves to Epic 11.
- [Source: .claude/rules/coding-style.md (DRY, file size), .claude/rules/testing.md (AAA,
  isolation, no `waitForTimeout`), .claude/rules/web-patterns.md (URL as state),
  .claude/rules/security-triggers.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
