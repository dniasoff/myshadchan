# Story 11.2: Resume auto-parse review

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the resume that landed in my Inbox read for me into an editable draft,
so that I confirm rather than retype — while the original stays exactly as I received it.

## Position in Epic 11

**2nd of 3.** Depends on **11.1**, which this story must not re-implement any part of:
`requireAiEntitlement` already guards every non-`/health` route on `workers/parse`;
`c.get("supabaseCaller")` / `c.get("aiEntitlement")` are already populated by the time this
story's route handler runs; `callAiWorker()` is the only sanctioned way the SPA calls a Worker.
If any of those three isn't true when this story starts, stop — 11.1 hasn't actually landed.

**The attachments shape is not an open question — one writer already exists.** The email
channel (`supabase/functions/postmark/extractAndUploadAttachments.ts`) already uploads inbound
attachments to the Supabase Storage bucket `attachments` and writes
`inbox_items.attachments` as an array of `{ title, type, path, src }` (`title` = original
filename, `type` = content type, `path` = the object path inside the `attachments` bucket,
`src` = a public URL). The SPA capture paths (`inbox/ShareTarget.tsx`,
`inbox/AddToInboxDialog.tsx`) are text-only today; Epic 10 finishes them — 10.1 adds the
share-path file capture and 10.3 verifies the email path end-to-end — and both keep this
shape (10.3 explicitly retains `extractAndUploadAttachments`). Epics.md never states the
Epic-10 dependency, but it is real: without 10.1/10.3 the only attachment writer is email.
This story codes `InboxAttachmentSchema` against the **existing** shape and parses
defensively, so a divergent Epic-10 shape degrades to the specified `422`, never a crash —
see "The attachments contract" in Dev Notes.

## Acceptance Criteria

1. **A new gated route:** `POST /parse` in `workers/parse/index.ts`, added after
   `app.use("*", requireAiEntitlement)` (11.1). Body: `{ inbox_item_id: number }`,
   Zod-validated (Consistency Conventions, "Worker API / validation"); a malformed body →
   `400` with `fail(...)`. It reads `c.get("supabaseCaller")` and `c.get("aiEntitlement")`
   from context — it does not construct a second client and does not call
   `.rpc("ai_entitlement")` again.
2. **The monthly cap is enforced here, not by 11.1.** If
   `aiEntitlement.resumes_used >= aiEntitlement.resumes_limit`, respond `402` with
   `fail("monthly resume limit reached")` **before** touching the extractor or storage — no
   inference is spent once the cap is hit, entitled or not.
3. **The inbox item is fetched through the caller-scoped client**, so RLS (AD-1,
   `"Inbox items scoped to account"`, `05_policies.sql:276-279`) is the only reason cross-account
   access is impossible — no `account_id` predicate is written by hand in this route. Not
   found (including a cross-account id) → `404` with `fail("inbox item not found")` —
   indistinguishable from "doesn't exist," never a different shape that would let a caller
   probe for another account's ids.
4. **No recognizable resume attachment → a clean refusal, not a crash.**
   `inbox_items.attachments` is parsed with `InboxAttachmentSchema` (Zod, matching the
   existing `{title, type, path, src}` shape the postmark function writes — see Dev Notes);
   if no entry validates and matches a resume-shaped `type` (`application/pdf` or `image/*`),
   respond `422` with `fail("no resume attachment found")`.
5. **Extraction is a swappable interface**, never a hard-coded network call inline in the
   route: `ResumeExtractor.extract(fileBytes, mimeType): Promise<RawExtraction>` in
   `workers/parse/resumeExtractor.ts`; the production implementation
   (`geminiExtractor`) calls Gemini **only through the Cloudflare AI Gateway** (AD-8) — never
   `generativelanguage.googleapis.com` directly. Route handler takes the extractor as an
   injectable parameter (defaulting to `geminiExtractor`) so tests supply a fake and no test
   makes a live network call.
6. **Never fabricate — mechanically, not just by prompt wording.** The raw extraction is
   validated field-by-field against `ParsedResumeDraftSchema` (Zod); any field that fails
   validation or is absent becomes `null` in the response, never a passed-through guess. Every
   field in the schema is nullable — the schema itself cannot represent "invented" data as
   required. **Scope of what "mechanically" covers here (added 2026-08-06, closing finding 10's
   documentation half — see `_bmad-output/epic-11-adversarial-review-report-2026-08-04.md`):**
   this mechanism enforces *structure*, not *provenance*. It guarantees an absent or
   malformed-shape field comes back `null` rather than a guess; it does not, and was never
   designed to, prove that a well-shaped returned value was actually present in the source
   document — there are no source spans or quotations tying a value back to the resume it was
   read from. That gap was reviewed and deliberately left unclosed: building source-grounding
   machinery was judged YAGNI because the human review gate in `InboxResolveDialog` (AC-10/11
   below) already covers the real risk, and AC-7's per-field confidence score is model-supplied
   and advisory — a "please check" flag for the reviewer, not proof of correctness.
7. **Low-confidence fields are flagged, not hidden.** A named constant
   `LOW_CONFIDENCE_THRESHOLD = 0.7` (`workers/parse/parsedResumeDraft.ts`) — any field whose raw
   per-field confidence is below it is listed by key in the response's `lowConfidenceFields:
   string[]`.
8. **Usage is metered at the moment of spend, once per successful call.** After the extractor
   call succeeds (regardless of what the user later does with the draft), `ai_usage
   .resumes_parsed` for the caller's account and the current `YYYY-MM` period is incremented by
   1, via `forAccount(String(row.account_id), env)` (service-role — `authenticated` holds no
   write grant on `ai_usage`, `06_grants.sql:585-587`; note `forAccount` takes a **string**
   accountId). `accountId` comes from the fetched `inbox_items` row's own `account_id` column
   (already scoped and trustworthy, since AC-3 fetched it through RLS) — never from a
   client-supplied field. Mechanics: `ScopedTable` exposes only `select/insert/update/delete`
   (no upsert, and supabase-js cannot express `set x = x + 1` anyway), so: select the period
   row; if present, `update({resumes_parsed: current + 1})`; if absent, `insert({period,
   resumes_parsed: 1})`, and if that insert hits the `ai_usage_account_id_period_key` unique
   constraint (concurrent first parse), retry the update once. A lost increment under exact
   concurrency is a bounded undercount on a soft monthly meter, not a ledger — acceptable, and
   noted here so nobody "fixes" it with a second SQL function this story doesn't own.
9. **The original is never touched.** No statement in this story's route issues `UPDATE` or
   `DELETE` against `inbox_items` — parsing is read-only on the capture. `InboxResolveDialog`
   continues to render `item.raw_text` / the attachment verbatim, unchanged by whether
   auto-fill ran, succeeded, or failed.
10. **The review UI, wired into the existing confirm step — no second dialog.**
    `InboxResolveDialog.tsx` gains an "Auto-fill from resume" action, shown only when the item
    has a resume-shaped attachment (a small local predicate in `useParseResume.ts` over the
    `attachments` array's `type` — the Worker's `findResumeAttachment` stays the authority;
    do not import `workers/` code into the SPA for a two-line content-type check) **and**
    `useAiEntitlement().isEntitled` is true (the existing client-side hint — `11.1`'s Worker
    gate is what actually enforces it). Because this makes the dialog a second consumer of the
    entitlement hook, `references/entitlementGate.guard.test.ts`'s `ALLOWED` set gains
    `InboxResolveDialog.tsx` — legitimate, since `useAiEntitlement.ts`'s own doc names resume
    auto-parse as one of the only two paid surfaces; without this the guard test fails the
    build. On click it calls `callAiWorker` against `${VITE_PARSE_WORKER_URL}/parse`; on
    success, the returned `fields` become the `Form`'s reset values — the full bilingual set
    `ShidduchInputs` renders: `name_en/he`, `parents_en/he`, `seminary_en/he`, `shul_en/he`,
    `location_en/he`, `age`, `height` (AD-12: a resume typically carries both scripts;
    extracting only the `_en` half would discard data the schema already stores) — and each
    key in `lowConfidenceFields` renders a "please check" badge next to that input; on failure
    (402/404/422/network) a `notify(..., {type:"warning"})` fires and the form is left exactly
    as it was — auto-fill failing never blocks filing manually.
11. **"Enter myself" needs no new code to satisfy this AC — it is the dialog's existing default
    state.** A test proves it: opening `InboxResolveDialog` without triggering auto-fill (or
    after it fails) still submits via the unchanged manual path.
12. **On save, when a draft was used, the reviewed data is attached to the new suggestion as a
    resume — not silently dropped.** Post-10.1, the dialog's submit path is the shared
    `inbox/useResolveInboxItem.ts` module (`resolveAsNewShidduch`), not inline dialog code —
    extend it **additively** (an optional draft argument, absent = today's behavior): after
    `createShidduch` succeeds it also calls `dataProvider.create("resumes", { data: {
    shidduchim_id: created.id, files: [attachment], extracted: rawDraftFromWorker, sections:
    draft.sections } })`. While in that mapping, ensure every field `ShidduchInputs` renders —
    including the `*_he` variants — survives into `CreateShidduchInput` (the pre-Epic-10
    dialog mapped only `name_he` plus the `_en` fields; if 10.1's module inherited that, widen
    the mapping additively here, or the drafted Hebrew values would render in the form and
    then vanish on save). This is a plain CRUD write on a table the user already has full
    grants on (`06_grants.sql:496-497`) — no new insert path is added for `shidduchim` itself
    (AD-4 unaffected).
13. **Negative test — extend Story 10.3's suite, do not recreate it.** Story 10.3 (Task 4)
    creates `supabase/tests/inbox_items.sql` + `.test.ts` covering cross-account `select`
    isolation, `with check` on writes carrying another account's `account_id`, and the
    `service_role` webhook insert. What it does **not** cover is this story's resolve path:
    add one assertion to that suite — a cross-account `UPDATE ... SET status = 'resolved'`
    targeting account B's row affects **zero** rows (the `USING` side, distinct from 10.3's
    `with check` case) — in the existing
    `insert into results (name, passed) select '<name>', ...` style. Only if 10.3 has not
    landed when this story starts, create the file per 10.3's own task (mirroring
    `supabase/tests/shidduch_catch.sql` + runner) and note the overlap in the PR.
14. **Verification.** `make typecheck`, `npm run lint`, `npm run test:unit:workers`, the `app`
    project's tests for the touched components, and `npm run test:unit:db` (needs
    `make start`) all pass. `npx prettier --config ./.prettierrc.json --check` over every file
    this story creates or touches.

## Tasks / Subtasks

- [ ] **Task 1 — The draft contract** (AC: 6, 7)
  - [ ] `workers/parse/parsedResumeDraft.ts`: `LOW_CONFIDENCE_THRESHOLD`,
        `RawExtractionSchema` (per-field `{ value: string | number | null; confidence: number }`
        for each of the twelve draft keys — `name_en, name_he, parents_en, parents_he,
        seminary_en, seminary_he, shul_en, shul_he, location_en, location_he, age, height` —
        plus `sections: { learningHistory: Array<{label,value}>, references:
        Array<{name,relationship,phone}> }`), and `ParsedResumeDraftSchema` (the public
        response shape: `fields` — the same twelve keys, each nullable — plus
        `lowConfidenceFields: string[]` and `sections`). A pure function
        `toDraft(raw: RawExtraction): ParsedResumeDraft` applies AC-6/AC-7: Zod-parse each
        field, `null` on failure, threshold check for the flag list.
  - [ ] `parsedResumeDraft.test.ts`: a field below threshold is flagged; a field failing schema
        validation becomes `null`, not passed through; an empty/garbage raw extraction yields
        an all-`null` draft, never a thrown error.

- [ ] **Task 2 — The attachments contract** (AC: 4)
  - [ ] `workers/parse/inboxAttachment.ts`: `InboxAttachmentSchema` (Zod, the shape
        `extractAndUploadAttachments` already writes: `{type: string, path: string,
        title: string.optional(), src: string.optional()}` — `type`/`path` required, the rest
        tolerated), an `ATTACHMENTS_BUCKET = "attachments"` constant (the bucket that function
        hardcodes), and `findResumeAttachment(attachments: unknown): InboxAttachment | null` —
        parses the raw jsonb defensively (never throws on an unexpected shape) and returns the
        first entry whose `type` starts with `application/pdf` or `image/`.
  - [ ] `inboxAttachment.test.ts`: valid PDF entry found; valid image entry found; empty/null
        `attachments` → `null`; malformed jsonb (wrong shape entirely, simulating a divergent
        Epic-10 outcome) → `null`, never a throw.

- [ ] **Task 3 — The extractor interface** (AC: 5)
  - [ ] `workers/parse/resumeExtractor.ts`: `interface ResumeExtractor { extract(fileBytes:
        ArrayBuffer, mimeType: string): Promise<RawExtraction> }` and `geminiExtractor:
        ResumeExtractor`, whose implementation calls the Cloudflare AI Gateway's Google
        AI-Studio-compatible endpoint (`https://gateway.ai.cloudflare.com/v1/
        <AI_GATEWAY_ACCOUNT_ID>/<AI_GATEWAY_ID>/google-ai-studio/...`) with
        `GOOGLE_AI_STUDIO_API_KEY`, requesting a JSON response constrained to
        `RawExtractionSchema`'s shape (Gemini's `responseMimeType: "application/json"`).
        Extend `ParseEnv` (new, in `workers/parse/index.ts`) with `AI_GATEWAY_ACCOUNT_ID`,
        `AI_GATEWAY_ID`, `GOOGLE_AI_STUDIO_API_KEY`; add all three to
        `workers/parse/wrangler.toml`'s secrets comment.
  - [ ] Deliberately out of scope (see Dev Notes "What this story does not build"): the
        deterministic Document AI/Vision fallback and the Transkribus/Kraken handwriting path
        AD-8 describes for degraded/handwritten pages.

- [ ] **Task 4 — The route** (AC: 1, 2, 3, 8, 9)
  - [ ] `workers/parse/index.ts`: `app.post("/parse", handler)` after the `app.use("*",
        requireAiEntitlement)` line 11.1 added. Handler order: (a) Zod-parse the body (AC-1);
        (b) cap check (AC-2); (c) fetch the `inbox_items` row by id via
        `c.get("supabaseCaller")` (AC-3); (d) `findResumeAttachment` (AC-4); (e) download the
        file via `supabaseCaller.storage.from(ATTACHMENTS_BUCKET).download(attachment.path)`
        (the storage policy grants `authenticated` `select` on bucket `attachments`,
        `07_storage.sql:6`); (f) `extractor.extract(...)`; (g) `toDraft(...)`; (h) the
        `forAccount(String(row.account_id), env).from("ai_usage")` select-then-update-or-insert
        increment for the current period (AC-8); (i) return `ok({ fields, lowConfidenceFields,
        sections, rawDraft: raw })` — `rawDraft` is what AC-12's client save later stores
        verbatim into `resumes.extracted`.
  - [ ] `index.test.ts`: full happy path with a fake extractor injected; each refusal case
        (cap reached, not found, no attachment) returns the documented status/error and never
        reaches the extractor (assert the fake extractor's mock was not called).

- [ ] **Task 5 — Client integration** (AC: 10, 11, 12)
  - [ ] `src/components/atomic-crm/inbox/useParseResume.ts`: a small hook wrapping
        `callAiWorker` (11.1) against `${import.meta.env.VITE_PARSE_WORKER_URL}/parse`,
        returning `{ parse, isParsing }`, plus the local `hasResumeShapedAttachment(item)`
        predicate (AC-10) with a one-line comment that the Worker's `findResumeAttachment` is
        the authority.
  - [ ] `InboxResolveDialog.tsx`: render the "Auto-fill from resume" button per AC-10 gating;
        on success, call the `Form`'s `reset()` (or pass computed `defaultValues`) with the
        draft's `fields`; render the low-confidence badges next to the matching
        `ShidduchInputs` fields (may need a small prop addition to `ShidduchInputs` to accept a
        `lowConfidenceFields` set — keep this addition minimal and additive, default `[]`, so
        the manual-entry call site is unaffected).
  - [ ] Add `"InboxResolveDialog.tsx"` to `references/entitlementGate.guard.test.ts`'s
        `ALLOWED` set (AC-10) — nothing else in that guard changes.
  - [ ] Save path: extend `useResolveInboxItem.ts`'s `resolveAsNewShidduch` per AC-12 (optional
        draft argument; the `resumes` create after `createShidduch`; the `*_he` mapping check);
        keep the dialog's existing `try/catch`-plus-`notify()` behavior so a resume-write
        failure surfaces without leaving the shidduch half-created silently unexplained.
  - [ ] `InboxResolveDialog.test.tsx` (new — none exists today; verified via
        `find src -iname 'InboxResolveDialog*'`): renders the raw capture unchanged after a
        successful auto-fill (AC-9); low-confidence badge renders for a flagged field; a failed
        auto-fill leaves the manual form usable and does not throw; "Enter myself" (opening
        without auto-fill) still files successfully (AC-11); save with a draft present creates
        both a shidduch and a resume row (mock `dataProvider.create`, assert the second call's
        `resource` argument is `"resumes"`).

- [ ] **Task 6 — SQL negative test** (AC: 13)
  - [ ] Extend `supabase/tests/inbox_items.sql` (created by Story 10.3) with the one missing
        assertion: as account A, `update public.inbox_items set status = 'resolved'` targeting
        account B's row affects zero rows. Use the suite's existing two-account fixture and
        `insert into results (name, passed) select ...` style — do not stand up a second
        fixture.
  - [ ] No schema change, no migration. Run `npm run test:unit:db` (needs `make start`).

- [ ] **Task 7 — Final verification** (AC: 14)
  - [ ] `make typecheck && npm run lint && npm run test:unit:workers && npm run test:unit:db`
        and the `app` project's tests for the touched/new inbox and references files
        (including `entitlementGate.guard.test.ts`, which must pass with the new `ALLOWED`
        entry).
  - [ ] `npx prettier --config ./.prettierrc.json --check` over every file this story creates
        or touches.

## Dev Notes

### The attachments contract

The shape is already in production, written by the email channel:
`supabase/functions/postmark/extractAndUploadAttachments.ts` uploads each inbound attachment
to the Storage bucket `attachments` (hardcoded there, same value as
`VITE_ATTACHMENTS_BUCKET`) and returns `{title, type, path, src}` objects that
`buildInboxItemPayload.ts` stores into `inbox_items.attachments`. `path` is the object key
inside that bucket; `type` is the content type; `src` is a public URL this story ignores (the
Worker downloads by `path` under the caller's own storage grant — `authenticated` holds
`select`/`insert`/`delete` on the bucket, `07_storage.sql:6-8`; note there is no `update`
policy, and the bucket's unscoped-path/public-URL weakness is a known gap flagged by 10.3, not
this story's to fix). Epic 10 keeps this shape (10.3 retains `extractAndUploadAttachments`;
10.1's share path should write the same objects). `findResumeAttachment` (Task 2) still parses
defensively: if a capture path ever writes something else, the route degrades to the specified
`422 "no resume attachment found"` rather than throwing, and updating `InboxAttachmentSchema`
is a small, isolated follow-up.

### What this story does not build

- **The deterministic OCR fallback** (Document AI / Cloud Vision for degraded typed pages) and
  the **handwriting path** (Transkribus/Kraken) AD-8 names are explicitly secondary paths for
  when Gemini's primary path degrades. Building both alongside the primary path in one story
  would be speculative (YAGNI) before the primary path has shipped and shown where it actually
  fails. This story ships Gemini-via-Gateway only; the fallback is a follow-up once real
  failure modes are observed.
- **Rate limiting** (AD-17's Upstash token-bucket, per-account/per-IP) is cross-cutting abuse
  prevention spanning every expensive endpoint in the product, not an Epic-11-specific
  acceptance criterion — epics.md's Story 11.1/11.2 ACs name entitlement and drafting, not
  request-rate limits. The `resumes_limit` monthly cap (AC-2) is a **cost cap**, already
  server-authoritative via `ai_entitlement()`; a **rate** cap (requests/minute) is a distinct,
  later hardening concern.
- **A `resumes` resource UI** (list/show, version history) is Epic 5 Story 5.3's job. This
  story only writes a `resumes` row via the plain dataProvider CRUD path (AC-12); it does not
  build any screen to browse or re-view it.
- **Langfuse tracing and the account-namespaced response cache** (both named by AD-8) are not
  wired by this story — a deliberate, labeled deviation: this is the product's first real
  inference call and no story in Epics 1-11 owns the tracing/caching infrastructure. Flagged
  to the epic owner as an unassigned AD-8 gap; do not half-build it inline here.

### Why the increment happens at parse time, not at save time

`ai_usage.resumes_parsed` meters *inference spent*, not *drafts accepted*. Gemini is called
(and billed) the moment `/parse` runs the extractor, regardless of whether the user later
clicks "Looks right — save" or discards the dialog. Metering at save time would let a caller
run unlimited parses for free as long as they never save, which defeats the cap AD-16 exists to
protect.

### Reuse — what already exists and must not be rebuilt

- `InboxResolveDialog.tsx` is **already** the "Confirm the details" screen the design comp's
  `isParse` mock describes almost verbatim (mock: *"The resume stays exactly as received — just
  check what we captured from it"*; dialog today: *"The capture stays exactly as received —
  just tell us who it's for"*) and it **already** calls `createShidduch` as the sole insert
  path (AD-4). This story adds an auto-fill affordance to it — it does **not** build a second,
  parallel confirm screen. [Source: mockup/MyShadchan.dc.html:632-690;
  src/components/atomic-crm/inbox/InboxResolveDialog.tsx]
- `CreateShidduchInput` (`types.ts`, `CreateShidduchInput`) already carries every bilingual
  scalar a resume yields — the twelve draft keys plus `single_id`/`shadchan_id` (post-1.3
  rename of `child_id`) — no new shidduch-level columns are needed for this story.
- `resumes` (`01_tables.sql:377-386`) already exists, already scoped/RLS'd
  (`05_policies.sql:132-135`) and already fully grants `authenticated`
  (`06_grants.sql:496-497`) — this story is its first real writer (verified: no
  `create("resumes")` call exists in `src/` today).
- **Demo build:** the FakeRest `aiEntitlement()` mirror is hardcoded unentitled
  (`fakerest/dataProvider.ts`, "Demo mode defaults to the FREE tier"), so the auto-fill button
  never renders in demo and `callAiWorker` needs no FakeRest mirror — AD-10 is satisfied
  without new demo code (`create("resumes")` is generic CRUD FakeRest already handles).

### Project Structure Notes

New: `workers/parse/parsedResumeDraft.ts` (+ test), `workers/parse/inboxAttachment.ts` (+
test), `workers/parse/resumeExtractor.ts`, `src/components/atomic-crm/inbox/useParseResume.ts`,
`src/components/atomic-crm/inbox/InboxResolveDialog.test.tsx`. Touched:
`workers/parse/index.ts` (+ test), `workers/parse/wrangler.toml`,
`src/components/atomic-crm/inbox/InboxResolveDialog.tsx`,
`src/components/atomic-crm/inbox/useResolveInboxItem.ts` (10.1's module, additive draft
argument), `src/components/atomic-crm/references/entitlementGate.guard.test.ts` (`ALLOWED`
entry), `supabase/tests/inbox_items.sql` (10.3's suite, one added assertion), possibly
`src/components/atomic-crm/shidduchim/ShidduchInputs.tsx` (additive `lowConfidenceFields`
prop only).

### Testing standard

AAA, no shared mutable state (`.claude/rules/testing.md`). All extractor calls in tests use the
`ResumeExtractor` interface's fake — no live Gemini/AI-Gateway network call anywhere in CI.
`InboxResolveDialog.test.tsx` runs under the `app` vitest project (real browser, per
`vitest.config.ts`), mocking `dataProvider` and `callAiWorker` at the module boundary, the same
way existing dialog-adjacent tests in this codebase already mock `useDataProvider`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-11.2]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-13, #Constraints "Never fabricate"]
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-4, #AD-6, #AD-7, #AD-8, #AD-16, #AD-17]
- [Source: 11-1-server-side-entitlement-on-inference.md — the gate, context values and
  `callAiWorker` this story depends on]
- [Source: supabase/schemas/01_tables.sql:377-410 — `resumes`, `inbox_items`]
- [Source: supabase/schemas/05_policies.sql:132-135, 276-279 — `resumes` and `inbox_items` RLS]
- [Source: supabase/schemas/06_grants.sql:496-497, 585-587, 610-612 — `resumes`, `ai_usage`,
  `inbox_items` grants]
- [Source: supabase/schemas/07_storage.sql — `attachments` bucket policies]
- [Source: supabase/functions/postmark/extractAndUploadAttachments.ts,
  buildInboxItemPayload.ts — the existing `{title, type, path, src}` attachment shape and the
  hardcoded `attachments` bucket]
- [Source: src/components/atomic-crm/inbox/InboxResolveDialog.tsx, ShareTarget.tsx,
  AddToInboxDialog.tsx]
- [Source: 10-1-share-target-completion.md — `useResolveInboxItem.ts`, the post-10.1 submit
  path this story extends; 10-3-email-ingress-verified-end-to-end.md — the
  `supabase/tests/inbox_items.sql` suite this story extends]
- [Source: mockup/MyShadchan.dc.html:632-690 — the `isParse` screen this story implements the
  server side of]
- [Source: design-artifacts/gap-analysis-v3.md §4 "isParse ... 0% ... No resume auto-fill
  review at all", §7, §9 item 13]

## Dev Agent Record

### Agent Model Used

moonshotai/kimi-k2.7-code

### Debug Log References

- Fixed Hono type cast in workers/parse/index.ts by using `as unknown as ParseApp`.
- Replaced `Buffer` with an explicit `arrayBufferToBase64` helper in workers/parse/resumeExtractor.ts because the Workers tsconfig does not include Node types.
- Fixed `DraftResetter` to preserve `single_id`/`shadchan_id`/`initial_state`/`redt_date` when merging a parsed draft.
- Adjusted `InboxResolveDialog.test.tsx` mock `update` to return the updated data so the stashed resume draft reaches the resolver.
- Added `QueryClient` to the `InboxResolveDialog` test renderer because `useAiEntitlement` now uses `useQuery`.

### Completion Notes List

- Created `workers/parse/parsedResumeDraft.ts` (+ test), `workers/parse/inboxAttachment.ts` (+ test), and `workers/parse/resumeExtractor.ts`.
- Added `POST /parse` to `workers/parse/index.ts` with cap check, RLS-scoped inbox fetch, attachment download, fake-injectable extractor, draft conversion, and `ai_usage` increment.
- Updated `workers/parse/wrangler.toml` to list the new AI Gateway / Gemini secrets.
- Created `src/components/atomic-crm/inbox/useParseResume.ts` and wired the auto-fill button into `InboxResolveDialog.tsx`.
- Extended `ShidduchInputs.tsx` with an additive `lowConfidenceFields` prop that renders "Please check" badges.
- Extended `useResolveInboxItem.ts` to optionally create a `resumes` row when a draft was used.
- Added `InboxResolveDialog.test.tsx` coverage for auto-fill, low-confidence badge, failed auto-fill fallback, and resume-row creation.
- Extended `supabase/tests/inbox_items.sql` with a cross-account UPDATE-USING resolve assertion and bumped the test's check count.
- Updated `references/entitlementGate.guard.test.ts` ALLOWED set and added English/French i18n strings for `crm.inbox.parse.*`.

### File List

- workers/parse/parsedResumeDraft.ts
- workers/parse/parsedResumeDraft.test.ts
- workers/parse/inboxAttachment.ts
- workers/parse/inboxAttachment.test.ts
- workers/parse/resumeExtractor.ts
- workers/parse/index.ts
- workers/parse/index.test.ts
- workers/parse/wrangler.toml
- src/components/atomic-crm/inbox/useParseResume.ts
- src/components/atomic-crm/inbox/InboxResolveDialog.tsx
- src/components/atomic-crm/inbox/InboxResolveDialog.test.tsx
- src/components/atomic-crm/inbox/useResolveInboxItem.ts
- src/components/atomic-crm/shidduchim/ShidduchInputs.tsx
- src/components/atomic-crm/references/entitlementGate.guard.test.ts
- src/components/atomic-crm/providers/commons/englishCrmMessages.ts
- src/components/atomic-crm/providers/commons/frenchCrmMessages.ts
- supabase/tests/inbox_items.sql
- supabase/tests/inbox_items.test.ts
- _bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md
