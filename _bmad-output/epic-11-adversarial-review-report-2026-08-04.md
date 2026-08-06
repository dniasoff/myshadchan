# Epic 11 Adversarial Review Report

Date: 2026-08-04

Skill used: `bmad-review-adversarial-general`

Status: Resolved — see "Resolution" below. Findings were independently re-verified before any fix was made, and most are now fixed and deployed to production; three items remain open.

## Resolution (2026-08-04)

All 16 findings were independently re-verified against the code before any fix was made. Result: 15 CONFIRMED, 1 PARTIAL (finding 10), 0 WRONG, 0 already-fixed.

Fixed and deployed to production in commits `481688e` and `c8a5234` (deployed via GitHub Actions run 30869931573, 2026-08-04): findings 1, 2, 3, 4, 5, 8 (partially), 9, 10 (bounds only), 11, 12, 13, 14.

- Finding 1 (CORS) is verified live in production by an actual unauthenticated `OPTIONS` preflight against both deployed Workers: an allowlisted origin gets `204` with `Access-Control-Allow-Origin`, and a non-allowlisted origin gets no such header.
- Finding 11 was closed structurally rather than directly: finding 12's fix deleted the free-form Claude narrator entirely, so there is no free-form output left for a paraphrase to bypass.
- Finding 10 was deliberately scoped down: only max-length bounds were added. Source-grounding machinery was judged YAGNI because the human review gate in the resolve dialog already covers the real risk. The epic's wording, not the code, was the overclaim.
- Finding 8 is only partially fixed: idempotency uses the Workers Cache API, which has no compare-and-set, so two simultaneous requests can still both miss. A full guarantee needs a table.

STILL OPEN: findings 6+7 (atomic quota reservation, needs a migration), 15 (missing Worker secrets in `deploy.yml`), 16 (rate limiting / tracing / caching on paid endpoints).

The new tests covering the highest-stakes fixes were mutation-tested: the CORS-ordering test, the auth-hole test, the size guard, the idempotency tests, the dossier zero-state test, and the surviving narrative tests were each confirmed to FAIL when the production behaviour they cover was removed. None was vacuous.

## Resolution addendum (2026-08-06)

This addendum corrects one stale line in the Resolution above and records the current state of
the remaining open items. It supplements the original Resolution; nothing above is edited or
retracted — this document is a historical record and the original findings, fix list, and "STILL
OPEN" line stand as written on 2026-08-04.

**Finding 15 — already closed; the "STILL OPEN" line above is stale.** `.github/workflows/deploy.yml`
now exports and pushes both `SUPABASE_PUBLISHABLE_KEY` (lines ~315-383) and the three AI Gateway
secrets `AI_GATEWAY_ACCOUNT_ID` / `AI_GATEWAY_ID` / `GOOGLE_AI_STUDIO_API_KEY` (lines ~328-397),
each gated on `IS_CLOUDFLARE_CONFIGURED` and the `ai`/`parse` matrix legs, with a fail-loud
`::warning::` plus a `GITHUB_STEP_SUMMARY` entry naming the exact downstream failure (an unhandled
`500` instead of `401`/`402` for the missing publishable key; every `POST /parse` request failing
for the missing Gateway trio) whenever the corresponding repository secret is absent. This was
re-confirmed directly against the current tree while preparing this addendum (`grep -n` over
`.github/workflows/deploy.yml` for the secret names and the `wrangler secret put` / `step-summary`
lines cited above). The "STILL OPEN" line above, written 2026-08-04, predates this fix and was
left un-updated; it should be read as superseded by this line, not as a current statement of the
workflow's contents.

**Findings 6, 7, 8 and 16 — closure in progress in this wave, described here as design intent, not
as verified, deployed fact.** Following this same adversarial review, an approved design closes
the remaining gaps in each:

- **Findings 6 and 7** (the unchecked read-modify-write meter, and the monthly cap's
  concurrent-overrun exposure): the approved design replaces `workers/parse/index.ts`'s step-9
  read-modify-write block entirely with a single atomic, `SECURITY DEFINER`
  `claim_ai_parse_attempt()` database function (paired with `confirm_ai_parse_attempt()` and
  `release_ai_parse_attempt()`) that performs the quota reservation and the increment as one
  transaction, refusing when the cap is exhausted and never returning a successful response unless
  the increment is durably recorded. A new `public.ai_parse_attempts` table backs it, reachable
  only from the Worker's service-role client (`EXECUTE` never granted to `authenticated`/`anon`),
  closing the cross-tenant quota-exhaustion and result-injection risk a client-reachable version
  would otherwise open. The monthly cap itself moves to a single new source of truth,
  `public.ai_monthly_resume_limit()`, read by both `ai_entitlement()` and the new claim function so
  the two can never silently disagree.
- **Finding 8** (the remainder still open after the earlier Cache-API mitigation): the same
  `ai_parse_attempts` table is also the idempotency ledger — a unique constraint on
  `(account_id, inbox_item_id, attachment_path)` gives the compare-and-set guarantee the Cache API
  could not, so a genuinely concurrent retry for the same attachment gets a bounded `409` rather
  than a second model call, and a completed attempt replays its cached result byte-for-byte.
  `workers/parse/parseIdempotency.ts` and its Cache-API call sites are removed as part of the same
  change, since the table is a strict superset of what the cache offered once the DB round trip is
  unavoidable on every request anyway (it is also now the cap check).
- **Finding 16** (rate limiting, tracing, and response caching left unowned): a new Story 11.4,
  "Operational controls for the AI Workers," has been added to Epic 11 in
  `_bmad-output/planning-artifacts/epics.md`, with its own acceptance criteria naming the
  fail-closed contract this finding asked for. Its design — Cloudflare's native `[[ratelimits]]`
  binding (IP- and caller-keyed, two bindings per Worker), a `console.warn`-based per-request trace
  line carrying a request id and a truncated caller-key prefix but never resume content, dossier
  narrative, or JWT material, and an account-namespaced `/dossier` response cache with a bounded
  120-second TTL — is recorded in full, including its rejected alternatives and an explicit
  "what this does NOT guarantee" section (per-colo approximation, per-caller rather than strictly
  per-account keying, and unverified Cloudflare-plan/`wrangler dev` behavior chief among them), in
  `_bmad-output/implementation-artifacts/11-4-operational-controls.md`.

**What this addendum does not claim.** The database migration, the `workers/parse/index.ts`
rewrite, the new `workers/shared/rateLimit.ts`/`requestTracing.ts`/`callerIdentity.ts` modules,
and `workers/ai/dossierCache.ts` were, at the time this addendum was written, being implemented by
other agents in the same work wave as this addendum — not by whoever wrote this paragraph, and not
verified by them. No claim is made here that any of it typechecks, passes its test suite, has been
migrated onto a real database, or has been deployed. Confirming that is this wave's own
verification phase's job, per `.claude/rules/gate-verification.md` and
`.claude/rules/migration-guard-integrity.md` — a guard's (or a story's) claimed closure is only
evidence once someone has actually watched the relevant gate run green against the real change, and
that had not yet happened when this addendum was written. Treat findings 6, 7, 8, and 16 as
**designed and story-owned**, not as **closed**, until a future dated addendum says otherwise on
the strength of that verification.

## Documentation-closure addendum (2026-08-06)

This addendum supplements the two sections above; nothing in them is edited or retracted.

**Finding 10's documentation half is now closed.** The Resolution above (line 17) already recorded
the finding's disposition: source-grounding machinery was deliberately scoped out as YAGNI, and
"the epic's wording, not the code, was the overclaim." That wording — `epics.md`'s Story 11.2
acceptance criterion "unknown fields are blank, never invented" — had not actually been amended in
the roughly six weeks since. A subsequent external review of Epic 11 (2026-08-06, 19 findings,
independently triaged against this tree) re-raised the identical gap as its own finding 15,
confirming it as `PARTIALLY_VALID`: the code-level complaint was invalid (the scoping decision
recorded here still holds and is working as designed), but the epic wording had genuinely never
been brought back into agreement with it. That review's triage note reads: "confirmed today, that
wording was never actually amended."

It has now been amended. `_bmad-output/planning-artifacts/epics.md`'s Story 11.2 acceptance
criteria were rewritten to distinguish structural validation (an absent or malformed field comes
back blank, never a guess) from proof that a value was present in the source document (not
established, and never claimed to be by the code); to describe the per-field confidence score
honestly as model-supplied and advisory; and to state plainly that the human review step, not the
extraction step, is what confirms a value is correct. The prior wording is not deleted — the new
text carries an inline note recording what it replaced and why, so the history stays legible. The
same clarification was added to `_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md`'s
own AC-6, which had echoed the same "mechanically" framing.

**A second, related drift was found and closed in the same pass, not originally part of this
report's 16 findings.** The same external review's finding 18 observed that Story 11.4's own
acceptance criterion — "a cached `/dossier` response is scoped to its account and never returned to
another account's request" — no longer matches the implementation: the account-namespaced
`/dossier` cache that criterion describes was built, then removed after a follow-up adversarial
review found its cache key collided across roles within one account (see
`_bmad-output/implementation-artifacts/11-4-operational-controls.md`, "Resolution note: C1"). That
implementation document had already flagged the drift and named the intended fix, but noted
`epics.md` was outside its own declared scope. `epics.md`'s Story 11.4 criterion has now been
amended to state the property the shipped code actually guarantees — RLS evaluated fresh on every
`/dossier` request, no cross-request cached state to leak — with the same inline record of what it
replaced and why.

**What this addendum does not claim, matching the caveat in the addendum above it.** These are
documentation edits, made by an agent whose declared scope in this wave was the planning and
implementation-artifact files, not the code. No claim is made here that any Worker code, migration,
or test suite in this same wave typechecks, passes, or has been deployed — that is unrelated to
this addendum and remains this wave's verification phase's job, per
`.claude/rules/gate-verification.md`. This addendum closes only the two documentation gaps named
above: the two files stating a guarantee the code does not (or no longer) provide, now restated to
match what is actually shipped.

## Scope Reviewed

Epic 11 stories and their implementation in the current repository state:

- Story 11.1: Server-side entitlement on inference
- Story 11.2: Resume auto-parse review
- Story 11.3: Diligence dossier

Commits reviewed:

- `5e6cace` — Story 11.1: server-side entitlement gate for AI Workers
- `eb633cd` — Story 11.2: resume auto-parse review
- `053122b` — Story 11.3: AI diligence dossier per suggestion

Primary specifications:

- [_bmad-output/planning-artifacts/epics.md](/home/daniel/repos/myshadchan/_bmad-output/planning-artifacts/epics.md:1357)
- [_bmad-output/implementation-artifacts/11-1-server-side-entitlement-on-inference.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/11-1-server-side-entitlement-on-inference.md:1)
- [_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md:1)
- [_bmad-output/implementation-artifacts/11-3-diligence-dossier.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/11-3-diligence-dossier.md:1)

## Executive Summary

The entitlement gate is present and tenant reads use the caller's JWT, but Epic 11 is not currently deliverable as a browser feature. Cross-origin preflight requests are rejected before the browser can send either AI request, and the deployment workflow does not provision several Worker secrets required by the new routes.

The resume flow also has a durable-data defect: it records an object from the private `attachments` bucket as though it lived in the `documents` bucket, making the saved resume undownloadable. Extracted parent fields are written under names the form does not consume. The remaining findings concern false dossier output, malformed-request handling, non-atomic metering, abuse resistance, and AI-output guarantees that are weaker than the epic contract claims.

## Findings

### 1. Browser CORS preflights are rejected before entitlement-protected requests can run

Priority: P1

`callAiWorker()` sends JSON with an `Authorization` header to a different Worker origin. Browsers must first send an unauthenticated `OPTIONS` preflight. Neither Worker installs CORS middleware, and `requireAiEntitlement` applies to every non-health path, so it rejects the preflight with `401`. The browser therefore never sends `POST /parse` or `POST /dossier`.

The Workers need an explicit origin allowlist, CORS response headers, and `OPTIONS` handling registered before the entitlement middleware. Tests should cover allowed and rejected origins as well as preflight behavior.

References:

- [src/components/atomic-crm/providers/commons/aiWorkerClient.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/providers/commons/aiWorkerClient.ts:20)
- [workers/shared/createApp.ts](/home/daniel/repos/myshadchan/workers/shared/createApp.ts:12)
- [workers/shared/aiEntitlementGate.ts](/home/daniel/repos/myshadchan/workers/shared/aiEntitlementGate.ts:49)
- [workers/parse/index.ts](/home/daniel/repos/myshadchan/workers/parse/index.ts:47)
- [workers/ai/index.ts](/home/daniel/repos/myshadchan/workers/ai/index.ts:46)

### 2. Auto-parsed resumes persist an object path under the wrong storage-bucket contract

Priority: P1

The resolution flow copies the original inbox attachment's path directly into a `ResumeFileVersion`. That object still lives in the `attachments` bucket, but all resume downloads sign file paths against the separate `documents` bucket. The Resume tab can display the saved row, but attempting to download its file fails.

The resolution must either copy the original object into the `documents` bucket and persist the new path, or extend the persisted file contract with trusted bucket provenance and sign the correct bucket.

References:

- [src/components/atomic-crm/inbox/useResolveInboxItem.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/useResolveInboxItem.ts:252)
- [src/components/atomic-crm/providers/supabase/resumes.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/providers/supabase/resumes.ts:17)
- [src/components/atomic-crm/providers/commons/attachments.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/providers/commons/attachments.ts:1)

### 3. Extracted parent fields do not match the shidduch form model

Priority: P2

The extractor returns `parents_en` and `parents_he`, while `ShidduchInputs` and the submit mapping consume `father_en`, `father_he`, `mother_en`, and `mother_he`. Resetting the form adds invisible keys that no rendered input or submit mapping reads, so extracted parent information is silently discarded when the suggestion is saved.

The extraction contract must map parent information into fields the form consumes. If a combined parent field is intentional, the review UI needs an explicit transformation or dedicated visible inputs instead of silently dropping it.

References:

- [src/components/atomic-crm/inbox/useParseResume.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/useParseResume.ts:10)
- [workers/parse/parsedResumeDraft.ts](/home/daniel/repos/myshadchan/workers/parse/parsedResumeDraft.ts:28)
- [src/components/atomic-crm/inbox/InboxResolveDialog.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/InboxResolveDialog.tsx:168)

### 4. The zero-row dossier reports that no topics are missing

Priority: P2

When a suggestion has no reference rows, `/dossier` returns `gaps: []`. The card interprets an empty gap list as "Every topic has been touched on," which is the opposite of the actual state. The normal fact builder correctly treats every coverage topic as missing when its corpus is empty.

The zero-row response should return every `COVERAGE_TOPICS` label as a gap, or the client should render an explicit no-data state that does not imply complete diligence.

References:

- [workers/ai/index.ts](/home/daniel/repos/myshadchan/workers/ai/index.ts:71)
- [workers/ai/dossierFacts.ts](/home/daniel/repos/myshadchan/workers/ai/dossierFacts.ts:118)
- [src/components/atomic-crm/references/DiligenceDossierCard.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/references/DiligenceDossierCard.tsx:104)

### 5. Malformed JSON bypasses the intended validation envelope

Priority: P2

Both routes await `c.req.json()` inside the argument to `safeParse`. Syntactically invalid JSON rejects before Zod runs, producing an unhandled Worker error instead of the documented `400` response with `fail("invalid request body")`.

JSON decoding must be caught separately before applying either body schema. Tests should submit malformed JSON rather than only well-formed JSON containing invalid field types.

References:

- [workers/parse/index.ts](/home/daniel/repos/myshadchan/workers/parse/index.ts:60)
- [workers/ai/index.ts](/home/daniel/repos/myshadchan/workers/ai/index.ts:53)

### 6. Usage-meter failures are silently accepted after inference has already been spent

Priority: P2

The existing-row update ignores its returned error. When an insert fails, the code assumes a uniqueness race, but a retry that returns no row or an update error is also ignored. The route then returns a successful draft even though no usage was recorded. During database or permission failures, a caller can repeatedly consume inference without advancing the monthly meter.

The spend and meter need a fail-closed, atomic database operation. At minimum, every update, insert, and retry result must be checked and a successful response must not be returned unless the usage increment is durably recorded.

Reference:

- [workers/parse/index.ts](/home/daniel/repos/myshadchan/workers/parse/index.ts:104)

### 7. The monthly allowance is vulnerable to concurrent overrun

The route trusts the `resumes_used` value returned by the earlier entitlement RPC, performs inference, and only afterward runs a read-modify-write increment. Multiple parallel requests can all observe allowance remaining and spend beyond the cap. The increment itself can also lose updates when two requests read the same current value.

Quota reservation and increment should be a single atomic database operation that refuses when the cap is exhausted. A reservation can be released or marked failed if inference does not complete.

References:

- [workers/parse/index.ts](/home/daniel/repos/myshadchan/workers/parse/index.ts:67)
- [supabase/schemas/02_functions.sql](/home/daniel/repos/myshadchan/supabase/schemas/02_functions.sql:3375)

### 8. Resume parsing has no idempotency contract

A retry after a browser timeout can invoke the model again, consume another unit, and return a different draft for the same inbox item. The endpoint has no idempotency key, parse-attempt record, or cached result keyed to the source object/version.

The route should identify a parse by account, inbox item, and stable attachment version or content hash, then reuse a completed result and safely resume an in-progress attempt.

Reference:

- [workers/parse/index.ts](/home/daniel/repos/myshadchan/workers/parse/index.ts:56)

### 9. Attachment size and complexity are unbounded before model submission

Any attachment labelled as a PDF or image is fully downloaded, converted to an `ArrayBuffer`, and then base64-encoded without byte-size, page-count, pixel-count, or execution-time limits. A large or pathological object can consume disproportionate Worker memory and model budget.

The Worker should enforce explicit MIME and byte limits before loading the whole file, reject unsupported or suspicious content, and define provider and Worker timeouts.

References:

- [workers/parse/inboxAttachment.ts](/home/daniel/repos/myshadchan/workers/parse/inboxAttachment.ts:19)
- [workers/parse/index.ts](/home/daniel/repos/myshadchan/workers/parse/index.ts:82)
- [workers/parse/resumeExtractor.ts](/home/daniel/repos/myshadchan/workers/parse/resumeExtractor.ts:14)

### 10. The "never invented" resume guarantee is not mechanically enforced

The schema validates output shape but accepts arbitrary strings and numbers, unbounded section arrays, and confidence values supplied by the same model that generated the extraction. It cannot establish that a value came from the source document. A hallucinated but well-shaped value passes unchanged into the editable draft and persisted extraction.

The contract should be narrowed with field-specific types and bounds, source evidence or spans, and an explicit review treatment for every unverified field. The wording in the epic should distinguish structural validation from proof that a value was present in the document.

References:

- [_bmad-output/planning-artifacts/epics.md](/home/daniel/repos/myshadchan/_bmad-output/planning-artifacts/epics.md:1380)
- [workers/parse/parsedResumeDraft.ts](/home/daniel/repos/myshadchan/workers/parse/parsedResumeDraft.ts:8)

### 11. The dossier's compatibility guard is only a small substring blacklist

The production narrator rejects six literal substrings. Semantically equivalent judgments such as "ideal pairing," "well suited," or "you should proceed" pass. This does not mechanically satisfy the epic's claim that the dossier never judges compatibility or suggests a match.

A reliable design should constrain the generated response to a validated structure and render deterministic prose, or apply a substantially stronger output policy with explicit negative tests for paraphrases and indirect recommendations.

References:

- [_bmad-output/planning-artifacts/epics.md](/home/daniel/repos/myshadchan/_bmad-output/planning-artifacts/epics.md:1394)
- [workers/ai/dossierNarrator.ts](/home/daniel/repos/myshadchan/workers/ai/dossierNarrator.ts:8)

### 12. Free-form dossier prose is not validated against the supplied facts

Although the model receives only aggregate counts and topic labels, its response is accepted whenever it avoids the banned substrings. It can invent a topic, attribute a view to references, or add a causal explanation not present in the input. The prompt asks it not to fabricate, but no output validation enforces grounding.

The route should validate a structured model response against the exact input fact set and render prose from validated fields. The existing deterministic narrative already demonstrates the safer shape.

Reference:

- [workers/ai/dossierNarrator.ts](/home/daniel/repos/myshadchan/workers/ai/dossierNarrator.ts:94)

### 13. "Contradiction" is inferred from sentiment cues rather than conflicting testimony

`hasContradiction` becomes true whenever at least one response contains an endorsement cue and another contains a hesitation cue. Those statements need not address the same topic or conflict with each other. A generally warm reference and a separate practical concern are therefore presented as disagreement.

The product should either label this signal accurately as "mixed sentiment" or compute contradiction per topic from structured claims that can actually oppose one another.

Reference:

- [workers/ai/dossierFacts.ts](/home/daniel/repos/myshadchan/workers/ai/dossierFacts.ts:99)

### 14. The narrator fallback test does not execute the behavior it claims to test

The test cannot access the Anthropic client captured inside the narrator closure. It conditionally patches a nonexistent exposed client, then calls `deterministicNarrative()` directly instead of invoking `narrator.compose()`. A regression that removes the production `catch` fallback would leave this test green.

Inject the model client or message-creation function, call `compose()`, and assert fallback for a thrown provider error, empty output, and banned output.

Reference:

- [workers/ai/dossierNarrator.test.ts](/home/daniel/repos/myshadchan/workers/ai/dossierNarrator.test.ts:98)

### 15. The deployment workflow does not provision the secrets required by Epic 11

The Worker matrix exports and pushes only the Supabase URL and service-role key as base secrets. It neither exports nor pushes `SUPABASE_PUBLISHABLE_KEY`, `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `GOOGLE_AI_STUDIO_API_KEY`, or `ANTHROPIC_API_KEY`, even though the Epic 11 Workers require them. The deploy step also runs before the secret-push steps, making a clean first deployment dependent on manual out-of-band setup.

The workflow should declare, validate, and provision each Worker-specific secret before deployment, with a clear failure when any required value is missing.

References:

- [.github/workflows/deploy.yml](/home/daniel/repos/myshadchan/.github/workflows/deploy.yml:361)
- [workers/parse/wrangler.toml](/home/daniel/repos/myshadchan/workers/parse/wrangler.toml:9)
- [workers/ai/wrangler.toml](/home/daniel/repos/myshadchan/workers/ai/wrangler.toml:9)

### 16. Epic-level abuse prevention, tracing, and response caching remain unowned

The new endpoints are paid, externally reachable inference surfaces, but no Epic 11 story owns account/IP rate limiting, request tracing, or account-namespaced response caching. The detailed story notes acknowledge parts of this gap, while the top-level epic presents the AI layer as complete and server-enforced.

These controls need an owning story and acceptance criteria before Epic 11 is considered operationally complete. In particular, paid-path enforcement should fail closed during limiter or metering failures.

References:

- [_bmad-output/planning-artifacts/epics.md](/home/daniel/repos/myshadchan/_bmad-output/planning-artifacts/epics.md:1357)
- [_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/11-2-resume-auto-parse-review.md:271)
- [_bmad-output/implementation-artifacts/11-3-diligence-dossier.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/11-3-diligence-dossier.md:287)

## Recommended Fix Order

1. Add and test browser CORS handling before the entitlement gate.
2. Correct resume-object durability by copying into `documents` or persisting bucket provenance.
3. Align parent-field extraction with the form contract.
4. Make quota reservation and usage recording atomic and fail-closed.
5. Fix zero-data dossier gaps and malformed JSON handling.
6. Add idempotency, file bounds, rate limiting, and deployment-secret validation.
7. Replace free-form AI guarantees with structured, mechanically validated outputs.
8. Repair narrator tests and add production-shaped integration coverage.

## Assumptions and Validation Notes

- The review assessed the current repository implementation plus the Epic 11 planning and implementation artifacts.
- The six P1/P2 findings supplied by the secondary reviewer were independently checked against the referenced source paths and incorporated above.
- No implementation changes or tests were run as part of documenting this report.
- The unrelated local modification to `supabase/functions/clear_demo/index.ts` was not touched.
