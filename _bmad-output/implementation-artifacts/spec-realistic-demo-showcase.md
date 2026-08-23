---
title: 'Realistic, feature-complete demo showcase'
type: 'feature'
created: '2026-08-21'
status: 'done'
baseline_commit: 'da19fd5'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `make start-demo` has solid breadth but still looks synthetic: several assets belong to the wrong people, portraits are labeled silhouettes, resumes are bare text pages, member names are partly random, one single has only three suggestions, and eleven seedable feature collections are empty.

**Approach:** Add a deterministic showcase layer that makes both singles' boards feel lived-in across every stage, populates every safe local workflow, and gives every seeded single and suggestion an identity-matched, local AI-generated portrait and polished fictional resume.

## Boundaries & Constraints

**Always:** Use fictional adults (18+) and synthetic portraits with no resemblance claim or real PII; keep portrait reveal and visibility controls intact; keep all assets local/offline; preserve valid IDs, foreign keys, account scopes, permissions, pipeline transitions, dates, and asset-to-person identity; make regeneration deterministic except for intentionally committed portrait source files; preserve the user's unrelated `src/App.tsx` change.

**Ask First:** Any schema/migration change, external paid service, destructive replacement of non-demo data, or change to privacy/permission rules.

**Never:** Scrape or ship real people's photos/resumes; weaken photo, medical, note, or thread privacy; fake successful Stripe, AI inference, email/push delivery, or Worker-backed public-share execution; add runtime network dependencies; overwrite the user's unrelated work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Showcase boot | `make start-demo` / default FakeRest provider | Deterministic populated household and shadchan contexts with no setup step | Existing controlled tests can request the non-showcase fixture |
| Profile assets | Open any seeded single or shidduch | Correct named resume versions and synthetic portrait; photo stays concealed until Reveal | Missing blob/manifest entry fails a coverage test |
| Asset regeneration | Run the asset generator | Committed portraits are preserved/optimized; PDFs and both base64 manifests are rebuilt | Fail closed on missing, duplicate, mismatched, or oversized assets |
| Role/privacy | Switch contexts or open sensitive tabs | Seeded content respects existing role, visibility, and moderation behavior | No bypass or fallback disclosure |

</frozen-after-approval>

## Code Map

- `src/components/atomic-crm/providers/fakerest/dataGenerator/{index,members,shidduchim,references,fileAssets,types}.ts` -- current FakeRest orchestration and domain fixtures.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.ts` -- new opt-in rich workflow seed layer.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` -- enable showcase data for the app while preserving controlled fixtures for tests.
- `supabase/functions/_shared/demoDataset.ts` and `supabase/functions/seed_demo/index.ts` -- keep the persistent demo's people/assets aligned and repair seed ordering if touched.
- `supabase/functions/seed_demo/assets/generate_assets.py` -- professional PDF generation, portrait validation/optimization, and manifest packing.
- `supabase/functions/seed_demo/assets/{portraits,resumes,misc}` plus `manifest*.ts` and `src/components/atomic-crm/providers/fakerest/dataGenerator/assets_base64.ts` -- committed project assets and generated manifests.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.test.ts` -- coverage, integrity, determinism, and identity assertions.

## Tasks & Acceptance

**Execution:**
- [x] `.gitignore` -- ignore `.claude/` and `.serena/` tooling state.
- [x] Generator files -- replace random/demo-thin records with coherent details and ensure each of the two singles has suggestions in all seven stages, with realistic families, schools, locations, ages, heights, backgrounds, histories, references, calls, tasks, and dates.
- [x] `showcase.ts` + `dataProvider.ts` -- seed discussions/messages, all inbox states and attachments, invitations, trusted senders, connections, grants, listings/withdrawals, share links/access, single-owned content, reminders/delivery states, files, notes, and analytics without destabilizing minimal test fixtures.
- [x] Asset generator and asset pack -- use built-in image generation for respectful photorealistic adult portraits; create designed one-page resumes and selected version histories; correct every subject mapping and regenerate both manifests.
- [x] Persistent demo files -- maintain identity/asset parity with the same curated dataset and keep seeding account-scoped and rerunnable only on empty accounts.
- [x] `showcase.test.ts` and affected focused tests -- assert every collection, relationship, state, asset, privacy level, and deterministic identity contract.

**Acceptance Criteria:**
- Given either seeded single, when the pipeline opens, then every canonical stage contains at least one coherent suggestion and the aggregate showcase has at least 20 suggestions.
- Given any seeded profile, when its Resume and Photo tabs open, then filenames/content/portrait match that person, resumes are polished and readable, and photos reveal only through the existing explicit action.
- Given the default parent and switchable shadchan contexts, when navigating the product, then every locally seedable major feature has meaningful linked data and no empty showcase surface remains accidentally empty.
- Given the asset generator and test suite, when run repeatedly, then manifests, IDs, relationships, and expected data remain stable and no real PII or remote asset URL is introduced.

## Design Notes

Keep baseline fixture behavior available to unit tests and layer showcase-only rows for the real FakeRest app. Treat generated portraits as committed source assets: the generator validates and optimizes them but never replaces them with placeholders.

## Verification

**Commands:**
- `python3 supabase/functions/seed_demo/assets/generate_assets.py` -- all portraits validate and PDFs/manifests regenerate.
- `npx vitest run src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.test.ts` -- showcase coverage and integrity pass.
- `make test && make typecheck && make lint && make build` -- repository gates pass.

**Manual checks (if no CLI):**
- Run `make start-demo`; inspect both singles' pipelines, representative 360 tabs, photo reveals, resume PDFs, inbox, reminders, reference calls, sharing/listings, discussions, and the shadchan context on desktop and mobile widths.

## Suggested Review Order

**Showcase entry and workflow coverage**

- Start where the default FakeRest app opts into the rich deterministic fixture.
  [`dataProvider.ts:1876`](../../src/components/atomic-crm/providers/fakerest/dataProvider.ts#L1876)

- Follow the overlay orchestration that preserves compact controlled fixtures.
  [`showcase.ts:1010`](../../src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.ts#L1010)

- Review the lived-in workflow collections and all inbox states.
  [`showcase.ts:470`](../../src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.ts#L470)

**Identity, privacy, and assets**

- Inspect the canonical 22-person identity-to-resume-to-portrait contract.
  [`fileAssets.ts:57`](../../src/components/atomic-crm/providers/fakerest/dataGenerator/fileAssets.ts#L57)

- Confirm manager and single views preserve row-level note privacy.
  [`dataProvider.ts:383`](../../src/components/atomic-crm/providers/fakerest/dataProvider.ts#L383)

- See local data URLs avoid remote signing while hosted attachments still re-sign.
  [`InboxCapturePreview.tsx:29`](../../src/components/atomic-crm/inbox/InboxCapturePreview.tsx#L29)

- Review fail-closed portrait, directory, and bundle-size validation.
  [`generate_assets.py:160`](../../supabase/functions/seed_demo/assets/generate_assets.py#L160)

- Check deterministic identity-manifest generation shared by both runtimes.
  [`generate_assets.py:355`](../../supabase/functions/seed_demo/assets/generate_assets.py#L355)

**Persistent seed and verification**

- Review adult, straight-only, stage, dependency, and asset validation.
  [`demoDataset.ts:800`](../../supabase/functions/_shared/demoDataset.ts#L800)

- Follow the account-scoped replacement seed from records through media uploads.
  [`index.ts:271`](../../supabase/functions/seed_demo/index.ts#L271)

- Finish with exhaustive FakeRest coverage, determinism, and privacy assertions.
  [`showcase.test.ts:44`](../../src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.test.ts#L44)

- Confirm hosted and FakeRest bytes match committed source assets.
  [`demoDataset.test.ts:22`](../../supabase/functions/_shared/demoDataset.test.ts#L22)
