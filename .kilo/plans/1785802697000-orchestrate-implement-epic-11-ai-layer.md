# Plan: Orchestrate and implement Epic 11 (AI Layer)

## Goal

Bring Epic 11 (AI Layer) from `ready-for-dev` to a deployed, green state by implementing Stories 11.1, 11.2, and 11.3 in dependency order, validating each before moving to the next, and pushing the whole epic through CI/CD.

## Context from previous session

- Previous session completed Epic 10 closeout and follow-up stories 10.4, 10.5, 10.6.
- Branch: `main` is up to date with commit `784ce34`.
- Epic 11 story files exist and are `ready-for-dev`:
  - `_bmad-output/implementation-artifacts/11-1-server-side-entitlement-on-inference.md`
  - `_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md`
  - `_bmad-output/implementation-artifacts/11-3-diligence-dossier.md`
- No Epic 11 code has been written yet; no schema migrations are required for 11.1.
- The AI entitlement SQL (`public.ai_entitlement()`, `subscription`, `ai_usage`) already exists from prior E4 work.
- Cloudflare Worker deployment (Gate G1 in Epic 12) is still blocked on repository secrets, but 11.1–11.3 can be built and unit-tested locally. Deployment of the new Worker routes themselves is part of the definition of done and depends on G1 being discharged.

## Phase 0 — Baseline and shared infrastructure

- [ ] Run `make typecheck`, `make test`, `make lint` on `main` to confirm a clean baseline.
- [ ] Ensure `.env.development` and `.env.e2e` are present and include the new Worker URL variables:
  - `VITE_PARSE_WORKER_URL=http://localhost:8788`
  - `VITE_AI_WORKER_URL=http://localhost:8789`
- [ ] Add `SUPABASE_PUBLISHABLE_KEY` to `workers/shared/env.ts` `BaseEnv`.
- [ ] Add `[dev] port = 8788` to `workers/parse/wrangler.toml` and `port = 8789` to `workers/ai/wrangler.toml`.
- [ ] Update both `wrangler.toml` secrets comment blocks to list `SUPABASE_PUBLISHABLE_KEY`.
- [ ] Verify `make typecheck` still passes after the shared env changes.

## Phase 1 — Implement Story 11.1 (Server-side entitlement on inference)

Story 11.1 is the gate every later route depends on. It must land and be green before 11.2 or 11.3 start.

- [ ] Create `workers/shared/aiEntitlementGate.ts`:
  - `createCallerClient(authHeader, env)` returning a publishable-key Supabase client with `persistSession: false`.
  - `AiEntitlementVariables` Hono variables type.
  - `requireAiEntitlement` middleware that:
    - Bypasses `/health` unconditionally.
    - Returns `401` on missing `Authorization` header.
    - Calls `.rpc("ai_entitlement")` under the caller's JWT.
    - Returns `402` on RPC error or `is_entitled !== true`.
    - Calls `c.set("supabaseCaller", client)` and `c.set("aiEntitlement", data)` on success, then `next()`.
- [ ] Wire `app.use("*", requireAiEntitlement)` in `workers/ai/index.ts` and `workers/parse/index.ts` right after `createWorkerApp(...)`.
- [ ] Create `src/components/atomic-crm/providers/commons/aiWorkerClient.ts` with `callAiWorker<T>(url, body)`.
- [ ] Add tests:
  - `workers/shared/aiEntitlementGate.test.ts` covering 401, 402-RPC-error, 402-unentitled, entitled `next()` with stashed values, and `/health` bypass.
  - `workers/ai/index.test.ts` and `workers/parse/index.test.ts`: `POST /probe` returns `402` for unentitled callers; `GET /health` still passes unauthenticated.
  - `aiWorkerClient.test.ts` (app project) covering bearer token attachment, `success:false` error propagation, and fetch rejection propagation.
- [ ] Run `make typecheck` and `npm run test:unit:workers` plus the app test for `aiWorkerClient`.
- [ ] Update `_bmad-output/implementation-artifacts/11-1-server-side-entitlement-on-inference.md`:
  - Mark `Status: done`.
  - Fill Dev Agent Record.

## Phase 2 — Implement Story 11.2 (Resume auto-parse review)

Story 11.2 depends on 11.1's gate, `callAiWorker`, and the existing `attachments` shape from Epic 10.

- [ ] Create `workers/parse/parsedResumeDraft.ts` with:
  - `LOW_CONFIDENCE_THRESHOLD = 0.7`.
  - `RawExtractionSchema` and `ParsedResumeDraftSchema`.
  - `toDraft(raw)` returning nullable fields, low-confidence flags, and sections.
- [ ] Create `workers/parse/parsedResumeDraft.test.ts`.
- [ ] Create `workers/parse/inboxAttachment.ts` with `InboxAttachmentSchema` and `findResumeAttachment()`.
- [ ] Create `workers/parse/inboxAttachment.test.ts`.
- [ ] Create `workers/parse/resumeExtractor.ts` with `ResumeExtractor` interface and `geminiExtractor` calling the Cloudflare AI Gateway.
  - Extend `ParseEnv` in `workers/parse/index.ts` with `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `GOOGLE_AI_STUDIO_API_KEY`.
  - Add these three secrets to `workers/parse/wrangler.toml` comment block.
- [ ] Add `POST /parse` route in `workers/parse/index.ts`:
  - Zod-validate `{ inbox_item_id: number }`.
  - Enforce monthly cap before extraction.
  - Fetch inbox item through caller-scoped client; 404 if not found.
  - Find resume attachment; 422 if none.
  - Download bytes from `attachments` bucket.
  - Run extractor; convert to draft.
  - Increment `ai_usage.resumes_parsed` via `forAccount(...)` with select/update-or-insert retry.
  - Return `ok({ fields, lowConfidenceFields, sections, rawDraft })`.
- [ ] Add `workers/parse/index.test.ts` cases: happy path with fake extractor, cap reached, not found, no attachment.
- [ ] Client integration:
  - Create `src/components/atomic-crm/inbox/useParseResume.ts` wrapping `callAiWorker` and local `hasResumeShapedAttachment` predicate.
  - Update `InboxResolveDialog.tsx` to render "Auto-fill from resume" button (gated by `useAiEntitlement`), call `parse`, reset form with draft fields, and render low-confidence badges.
  - Add an additive `lowConfidenceFields` prop to `ShidduchInputs` if needed (default `[]`).
  - Extend `useResolveInboxItem.ts` `resolveAsNewShidduch` with an optional draft argument; after `createShidduch`, create a `resumes` row with the attachment and extracted draft.
  - Ensure every `*_he` field in the draft maps through `CreateShidduchInput`.
  - Add `InboxResolveDialog.tsx` to `references/entitlementGate.guard.test.ts`'s `ALLOWED` set.
- [ ] Add `InboxResolveDialog.test.tsx` covering: raw capture unchanged after auto-fill, low-confidence badge, failed auto-fill leaves manual form usable, manual entry still files, save with draft creates shidduch + resume.
- [ ] Extend `supabase/tests/inbox_items.sql` (from Story 10.3) with one assertion: cross-account `UPDATE ... SET status = 'resolved'` affects zero rows.
- [ ] Run `make typecheck`, `npm run lint`, `npm run test:unit:workers`, app tests for touched inbox/references files, and `npm run test:unit:db`.
- [ ] Update `_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md`:
  - Mark `Status: done`.
  - Fill Dev Agent Record.

## Phase 3 — Implement Story 11.3 (Diligence dossier)

Story 11.3 depends on 11.1 and assumes Epic 5.10/5.11 have landed the Diligence tab and `ResearchAssistantPanel` structure.

- [ ] Verify preconditions before coding:
  - The shidduch Diligence tab renders `ShidduchReferencesSection.tsx`.
  - `ResearchAssistantPanel.tsx` is still on the Reference 360 `assistant` tab and entitlement-gated.
- [ ] Move (do not copy) `src/components/atomic-crm/references/crossReferenceSummary.ts` and its test to `workers/ai/dossierFacts.ts` / `dossierFacts.test.ts`.
  - Fix imports: type-only `ReferenceLinkSummary` from `src/types`; value import of `getCallStatusDescriptor` from `src/references/callStatus` only after verifying `callStatus.ts` has no runtime React/ra-core imports.
- [ ] Create `workers/ai/dossierNarrator.ts` (+ `.test.ts`):
  **[SUPERSEDED — Story 11.3 adversarial review, Finding 12: no Claude narrator was built. `dossierNarrator.ts` ships `deterministicNarrative()` only, with no fallback needed. The sub-items below describing a free-form model narrator are struck through and must not be built — see the file's header comment for why.]**
  - ~~`DossierNarrator` interface.~~ (not built — no narrator interface exists; `deterministicNarrative` is the only implementation)
  - `deterministicNarrative(facts)` template.
  - Banned-phrase list and checker.
  - ~~`claudeNarrator` using `@anthropic-ai/sdk` with Cloudflare AI Gateway `baseURL` override.~~
  - ~~Add `@anthropic-ai/sdk` to `package.json` (0.112.x per Stack table).~~ (dependency removed, not re-added)
  - ~~Extend `AiEnv` in `workers/ai/index.ts` with `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `ANTHROPIC_API_KEY`.~~ (`AiEnv` carries none of these)
  - ~~Add these three secrets to `workers/ai/wrangler.toml` comment block.~~
- [ ] Add `POST /dossier` route in `workers/ai/index.ts`:
  - Zod-validate `{ shidduchim_id: number }`.
  - Fetch `reference_links_summary` filtered by `shidduchim_id` via caller-scoped client.
  - Compute `buildCrossReferenceSummary` on the fetched rows.
  - ~~Compose narrative via `DossierNarrator` with deterministic fallback on failure/banned phrases.~~ Compose narrative via `deterministicNarrative` directly — no fallback needed, it is the only implementation.
  - Return the aggregate shape: counts, `covered`, `gaps`, ~~`hasContradiction`~~ **`hasMixedSentiment`** (renamed — Finding 13, the field is a whole-corpus sentiment split, not a same-topic contradiction check), `narrative`.
  - On zero rows, return the same shape with "nothing logged yet" deterministic narrative.
- [ ] Add `workers/ai/index.test.ts` cases: happy path with fixture links, zero-rows case.
- [ ] Client integration:
  - Create `src/components/atomic-crm/references/DiligenceDossierCard.tsx` (+ test), mounted on the shidduch Diligence tab above `ShidduchReferencesSection`.
  - Gated by `useAiEntitlement()`; renders upgrade prompt when unentitled.
  - Calls `callAiWorker(`${VITE_AI_WORKER_URL}/dossier`, { shidduchim_id })` and renders Consensus / Contradiction / Gaps.
  - Remove the summary section and `buildCrossReferenceSummary` import from `ResearchAssistantPanel.tsx`.
  - Add `DiligenceDossierCard.tsx` to `references/entitlementGate.guard.test.ts`'s `ALLOWED` set.
- [ ] Run the AC-12 greps:
  - `grep -rn "buildCrossReferenceSummary" src/` should return zero hits.
  - `grep -rn "buildCrossReferenceSummary" workers/` should return the new home.
- [ ] Run `make typecheck`, `npm run lint`, `npm run test:unit:workers`, app tests for touched/relocated files, and `npm run test:unit:db`.
- [ ] Update `_bmad-output/implementation-artifacts/11-3-diligence-dossier.md`:
  - Mark `Status: done`.
  - Fill Dev Agent Record.

## Phase 4 — Epic-wide pre-deploy validation

- [ ] `make typecheck` passes.
- [ ] `make test` passes.
- [ ] `make lint` passes (or only the unrelated `.kilo/agent-manager.json` and `.agents/skills/**` warnings remain).
- [ ] `npm run test:unit:workers` passes.
- [ ] `npm run test:unit:db` passes (needs `make start`).
- [ ] `npm run test:unit:db -- column_order` passes (no schema columns were added in this epic, but run it anyway).
- [ ] `npx prettier --config ./.prettierrc.json --check` over every file created, moved, or touched in this epic.
- [ ] Regenerate `registry.json` if any new components are added (`make registry-gen`).

## Phase 5 — Commit and push

- [ ] Stage and commit Story 11.1 with a clear message.
- [ ] Stage and commit Story 11.2 with a clear message.
- [ ] Stage and commit Story 11.3 with a clear message (note the file move in the commit body).
- [ ] Push `main` to `origin`.
- [ ] Monitor the `deploy.yml` run and confirm:
  - Supabase migrations deploy (none for this epic, but verify no-op).
  - Edge functions deploy (none changed, but verify no-op).
  - Cloudflare Workers deploy job is unblocked if Gate G1 secrets are provisioned; if G1 is still blocked, document that 11.1–11.3 are built and tested but Worker deployment is pending on `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.
- [ ] After deploy (or after G1 is discharged and deploy completes), smoke-test:
  - `GET /health` on both Workers returns 200 without auth.
  - An unentitled `POST` to `/parse` or `/dossier` returns 402.
  - An entitled `POST` to `/dossier` for a shidduch with no logged references returns the "nothing logged yet" shape.

## Out of scope

- Epic 12 work (dashboard reminders card, reminder delivery, family-shared tasks, Stripe billing).
- Gate G1 (Cloudflare Worker secrets, Resend domain, Stripe secrets) — tracked in Epic 12; this epic's Worker routes cannot be delivered until G1 is discharged, but they can be built and tested.
- Deterministic OCR / handwriting fallbacks for resume parsing.
- Langfuse tracing and account-namespaced response cache (AD-8 gaps flagged to epic owner).
- Rate limiting (AD-17) beyond the monthly `ai_usage` caps.
- A UI for browsing `resumes` rows — owned by Epic 5 Story 5.3.
- Changing `ai_entitlement()` SQL, `subscription`, `ai_usage`, or `useAiEntitlement.ts` — all remain untouched.

## Risks

1. **Worker type boundary violation.** `workers/ai/dossierFacts.ts` imports `getCallStatusDescriptor` by value from `src/references/callStatus.ts`. If that file later gains a React/ra-core runtime import, the Worker bundle breaks. Verify with the grep in Task 1 before starting and note it as a review signal.
2. **Hono generic widening.** Adding `app.use("*", requireAiEntitlement)` may require widening `createWorkerApp`'s `Variables` generic if Hono inference fails.
3. **Epic 5 dependency drift.** Story 11.3 assumes 5.10/5.11 have landed the Diligence tab and `ResearchAssistantPanel` placement. Verify these preconditions in Phase 3 before moving code.
4. **AI Gateway credentials absent locally.** The Gemini extractor can be unit-tested with fakes; live integration requires `AI_GATEWAY_*` and API keys that may not exist in local `.env` files. Do not block development on live keys. *(Resolved differently for the narrator: it ships deterministic, with no model call and no Anthropic dependency — Story 11.3 adversarial review, Finding 12 — so this risk never applied to it.)*
5. **`ai_usage` concurrency.** The select-then-update-or-insert pattern in 11.2 can undercount under exact concurrency; this is accepted and documented in the story. Avoid "fixing" it with a new SQL function.
6. **Entitlement guard test staleness.** Every new `useAiEntitlement` consumer (`InboxResolveDialog.tsx`, `DiligenceDossierCard.tsx`) must be added to `references/entitlementGate.guard.test.ts`'s `ALLOWED` set or the build fails.
7. **Translation parity.** Any new UI strings (upgrade prompt, low-confidence badge, dossier card labels) need French twins or `make typecheck` fails.
8. **Epic 10 attachment shape mismatch.** `findResumeAttachment` parses defensively, but if Epic 10's attachment shape diverges from `{title, type, path, src}`, resume auto-parse degrades to `422` until `InboxAttachmentSchema` is updated.

## Open questions

- Are `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` already provisioned? If yes, Phase 5 deployment is unblocked. If no, who provisions them?
- Are live `GOOGLE_AI_STUDIO_API_KEY` / `AI_GATEWAY_*` values available for integration testing, or should the epic ship tested against fakes only? *(`ANTHROPIC_API_KEY` — moot: the dossier narrator ships deterministic, no model call — Story 11.3 adversarial review, Finding 12.)*
- Does the current Diligence tab module (post-Epic-5) expose a stable mount point for `DiligenceDossierCard.tsx`?
