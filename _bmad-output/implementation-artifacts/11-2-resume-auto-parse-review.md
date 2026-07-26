# Story 11.2: Resume auto-parse review

Status: ready-for-dev

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

**Cross-epic dependency the epic list does not state:** this story needs a real file sitting in
`inbox_items.attachments` to parse. Today **no capture path writes one** —
`inbox/ShareTarget.tsx` and `inbox/AddToInboxDialog.tsx` are text-only (verified: neither
references `attachments` or any storage upload call). Epic 10, "Capture Funnel Completion,"
covers FR27-28/FR78 and is the epic whose job is finishing inbox capture, including file
attachments; it lands before Epic 11 in the epic list order but epics.md never states the
dependency explicitly. **This story assumes Epic 10 has landed a shape for
`inbox_items.attachments`** — see "The attachments shape assumption" in Dev Notes for the exact
`[ASSUMPTION]` this story codes against and how it degrades gracefully if the real shape
differs.

## Acceptance Criteria

1. **A new gated route:** `POST /parse` in `workers/parse/index.ts`, added after
   `app.use("*", requireAiEntitlement)` (11.1). Body: `{ inbox_item_id: number }`. It reads
   `c.get("supabaseCaller")` and `c.get("aiEntitlement")` from context — it does not construct
   a second client and does not call `.rpc("ai_entitlement")` again.
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
   `inbox_items.attachments` is parsed with `InboxAttachmentSchema` (Zod, per the
   `[ASSUMPTION]` in Dev Notes); if no entry validates and matches a resume-shaped
   `content_type` (`application/pdf` or `image/*`), respond `422` with
   `fail("no resume attachment found")`.
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
   required.
7. **Low-confidence fields are flagged, not hidden.** A named constant
   `LOW_CONFIDENCE_THRESHOLD = 0.7` (`workers/parse/parsedResumeDraft.ts`) — any field whose raw
   per-field confidence is below it is listed by key in the response's `lowConfidenceFields:
   string[]`.
8. **Usage is metered at the moment of spend, once per successful call.** After the extractor
   call succeeds (regardless of what the user later does with the draft), `ai_usage
   .resumes_parsed` for the caller's account and the current `YYYY-MM` period is incremented by
   exactly 1, via `forAccount(accountId, env)` (service-role — `authenticated` holds no write
   grant on `ai_usage`, `06_grants.sql:585-587`). `accountId` for this call comes from the
   fetched `inbox_items` row's own `account_id` column (already scoped and trustworthy, since
   AC-3 fetched it through RLS) — never from a client-supplied field.
9. **The original is never touched.** No statement in this story's route issues `UPDATE` or
   `DELETE` against `inbox_items` — parsing is read-only on the capture. `InboxResolveDialog`
   continues to render `item.raw_text` / the attachment verbatim, unchanged by whether
   auto-fill ran, succeeded, or failed.
10. **The review UI, wired into the existing confirm step — no second dialog.**
    `InboxResolveDialog.tsx` gains an "Auto-fill from resume" action, shown only when the item
    has an attachment `InboxAttachmentSchema` recognizes as resume-shaped **and**
    `useAiEntitlement().isEntitled` is true (the existing client-side hint — `11.1`'s Worker
    gate is what actually enforces it). On click it calls `callAiWorker` against
    `${VITE_PARSE_WORKER_URL}/parse`; on success, the returned `fields` become the `Form`'s
    reset values (`ShidduchInputs`' fields: `name_en`, `name_he`, `parents_en`, `seminary_en`,
    `shul_en`, `location_en`, `age`, `height`) and each key in `lowConfidenceFields` renders a
    "please check" badge next to that input; on failure (402/404/422/network) a `notify(...,
    {type:"warning"})` fires and the form is left exactly as it was — auto-fill failing never
    blocks filing manually.
11. **"Enter myself" needs no new code to satisfy this AC — it is the dialog's existing default
    state.** A test proves it: opening `InboxResolveDialog` without triggering auto-fill (or
    after it fails) still submits via the unchanged manual path.
12. **On save, when a draft was used, the reviewed data is attached to the new suggestion as a
    resume — not silently dropped.** After `createShidduch` succeeds,
    `InboxResolveDialog`'s submit handler also calls `dataProvider.create("resumes", { data: {
    shidduchim_id: created.id, files: [attachment], extracted: rawDraftFromWorker, sections:
    draft.sections } })`. This is a plain CRUD write on a table the user already has full
    grants on (`06_grants.sql:496-497`) — no new insert path is added for `shidduchim` itself
    (AD-4 unaffected).
13. **Negative test — a genuine gap this story closes.** No `.sql` test file today asserts
    `inbox_items` cross-account isolation (verified:
    `grep -rl inbox_items supabase/tests/` returns nothing). Add
    `supabase/tests/inbox_items.sql`, mirroring the two-account setup and
    `insert into results (name, passed) select '<name>', count(*) = 0 from ...` style already
    used in `supabase/tests/references_entity.sql:370-379`: assert account A reads zero rows of
    account B's `inbox_items`, and that account A cannot resolve (`UPDATE ... SET status`)
    account B's row.
14. **Verification.** `make typecheck`, `npm run lint`, `npm run test:unit:workers`, the `app`
    project's tests for the touched components, and `npm run test:unit:db` (needs
    `make start`) all pass. `npx prettier --config ./.prettierrc.json --check` over every file
    this story creates or touches.

## Tasks / Subtasks

- [ ] **Task 1 — The draft contract** (AC: 6, 7)
  - [ ] `workers/parse/parsedResumeDraft.ts`: `LOW_CONFIDENCE_THRESHOLD`,
        `RawExtractionSchema` (per-field `{ value: string | number | null; confidence: number
        }}` for each of `name_en, name_he, parents_en, seminary_en, shul_en, location_en, age,
        height` plus `sections: { learningHistory: Array<{label,value}>, references:
        Array<{name,relationship,phone}> }`), and `ParsedResumeDraftSchema` (the public
        response shape: `fields` — the same eight keys, each nullable — plus
        `lowConfidenceFields: string[]` and `sections`). A pure function
        `toDraft(raw: RawExtraction): ParsedResumeDraft` applies AC-6/AC-7: Zod-parse each
        field, `null` on failure, threshold check for the flag list.
  - [ ] `parsedResumeDraft.test.ts`: a field below threshold is flagged; a field failing schema
        validation becomes `null`, not passed through; an empty/garbage raw extraction yields
        an all-`null` draft, never a thrown error.

- [ ] **Task 2 — The attachments contract** (AC: 4)
  - [ ] `workers/parse/inboxAttachment.ts`: `InboxAttachmentSchema` (Zod;
        `{bucket:string, path:string, content_type:string, filename:string.optional()}`),
        `findResumeAttachment(attachments: unknown): InboxAttachment | null` — parses the raw
        jsonb defensively (never throws on an unexpected shape) and returns the first entry
        whose `content_type` starts with `application/pdf` or `image/`.
  - [ ] `inboxAttachment.test.ts`: valid PDF entry found; valid image entry found; empty/null
        `attachments` → `null`; malformed jsonb (wrong shape entirely, simulating a different
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
        requireAiEntitlement)` line 11.1 added. Handler order: (a) cap check (AC-2); (b) fetch
        `inbox_items` row by id via `c.get("supabaseCaller")` (AC-3); (c) `findResumeAttachment`
        (AC-4); (d) download the file via `supabaseCaller.storage.from(attachment.bucket)
        .download(attachment.path)` (the storage policies already grant `authenticated`
        `select` on bucket `attachments`, `07_storage.sql:6`); (e) `extractor.extract(...)`;
        (f) `toDraft(...)`; (g) `forAccount(row.account_id, env).from("ai_usage")` upsert-style
        increment for the current period (AC-8); (h) return `ok({ fields, lowConfidenceFields,
        sections, rawDraft: raw })` — `rawDraft` is what AC-12's client save later stores
        verbatim into `resumes.extracted`.
  - [ ] `index.test.ts`: full happy path with a fake extractor injected; each refusal case
        (cap reached, not found, no attachment) returns the documented status/error and never
        reaches the extractor (assert the fake extractor's mock was not called).

- [ ] **Task 5 — Client integration** (AC: 10, 11, 12)
  - [ ] `src/components/atomic-crm/inbox/useParseResume.ts`: a small hook wrapping
        `callAiWorker` (11.1) against `${import.meta.env.VITE_PARSE_WORKER_URL}/parse`,
        returning `{ parse, isParsing }`.
  - [ ] `InboxResolveDialog.tsx`: render the "Auto-fill from resume" button per AC-10 gating;
        on success, call the `Form`'s `reset()` (or pass computed `defaultValues`) with the
        draft's `fields`; render the low-confidence badges next to the matching
        `ShidduchInputs` fields (may need a small prop addition to `ShidduchInputs` to accept a
        `lowConfidenceFields` set — keep this addition minimal and additive, default `[]`, so
        the manual-entry call site is unaffected).
  - [ ] Submit handler: after `createShidduch`, when a draft is present, `dataProvider.create
        ("resumes", {...})` per AC-12; wrap in the existing `try/catch` so a resume-write
        failure still surfaces via `notify()` without leaving the shidduch half-created
        silently unexplained.
  - [ ] `InboxResolveDialog.test.tsx` (new — none exists today; verified via
        `find src -iname 'InboxResolveDialog*'`): renders the raw capture unchanged after a
        successful auto-fill (AC-9); low-confidence badge renders for a flagged field; a failed
        auto-fill leaves the manual form usable and does not throw; "Enter myself" (opening
        without auto-fill) still files successfully (AC-11); save with a draft present creates
        both a shidduch and a resume row (mock `dataProvider.create`, assert the second call's
        `resource` argument is `"resumes"`).

- [ ] **Task 6 — SQL negative test** (AC: 13)
  - [ ] `supabase/tests/inbox_items.sql`, following the two-account fixture pattern in
        `supabase/tests/references_entity.sql` (search that file for how it stands up two
        accounts + members before its RLS block, ~lines 355-380, and mirror the setup rather
        than inventing a new one). Assert cross-account `select` returns zero rows and a
        cross-account `update ... set status` affects zero rows.
  - [ ] Run via `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local` (no
        schema change is needed for this file — it is a test fixture only, not a migration) and
        `npm run test:unit:db`.

- [ ] **Task 7 — Final verification** (AC: 14)
  - [ ] `make typecheck && npm run lint && npm run test:unit:workers && npm run test:unit:db`
        and the `app` project's tests for the two touched/new inbox files.
  - [ ] `npx prettier --config ./.prettierrc.json --check` over every file this story creates
        or touches.

## Dev Notes

### The attachments shape assumption `[ASSUMPTION]`

Neither current inbox-capture path (`ShareTarget.tsx`, text-only via `URLSearchParams`;
`AddToInboxDialog.tsx`, a plain `Textarea`) writes anything into `inbox_items.attachments`
today — it is an unused `jsonb` column (`01_tables.sql:403`). Epic 10 ("Capture Funnel
Completion") is what actually wires a file upload into it, and its exact shape isn't decided
yet. This story assumes an array of `{bucket, path, content_type, filename?}` objects pointing
at the existing Supabase Storage bucket `attachments` (`VITE_ATTACHMENTS_BUCKET=attachments`,
`.env.development:8`; bucket policies already grant `authenticated` full CRUD scoped only by
`bucket_id`, `07_storage.sql:6-8`) — the most direct shape given the storage surface that
already exists. `findResumeAttachment` (Task 2) is written defensively specifically so that if
Epic 10 lands a different shape, this story's route degrades to the already-specified `422 "no
resume attachment found"` rather than throwing — the failure mode was chosen to be safe against
this exact uncertainty. If Epic 10's real shape differs materially, updating `InboxAttachment
Schema` is a small, isolated follow-up; it does not change the route's contract or any other
task in this story.

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
- `CreateShidduchInput`'s eight scalar fields (`types.ts:494` region) are exactly the fields a
  resume carries — no new shidduch-level columns are needed for this story.
- `resumes` (`01_tables.sql:377-386`) already exists, already scoped/RLS'd
  (`05_policies.sql:132-135`) and already fully grants `authenticated` (`06_grants.sql:
  496-497) — this story is its first real writer.

### Project Structure Notes

New: `workers/parse/parsedResumeDraft.ts` (+ test), `workers/parse/inboxAttachment.ts` (+
test), `workers/parse/resumeExtractor.ts`, `src/components/atomic-crm/inbox/useParseResume.ts`,
`src/components/atomic-crm/inbox/InboxResolveDialog.test.tsx`,
`supabase/tests/inbox_items.sql`. Touched: `workers/parse/index.ts` (+ test),
`workers/parse/wrangler.toml`, `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`,
possibly `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx` (additive
`lowConfidenceFields` prop only).

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
- [Source: src/components/atomic-crm/inbox/InboxResolveDialog.tsx, ShareTarget.tsx,
  AddToInboxDialog.tsx]
- [Source: mockup/MyShadchan.dc.html:632-690 — the `isParse` screen this story implements the
  server side of]
- [Source: design-artifacts/gap-analysis-v3.md §4 "isParse ... 0% ... No resume auto-fill
  review at all", §7, §9 item 13]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
