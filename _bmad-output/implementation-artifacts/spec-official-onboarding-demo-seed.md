---
title: 'Make the official onboarding demo a contained full-product sandbox'
type: 'feature'
created: '2026-08-22'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '433840faa7956594343d610763b1b0a2b0f1e8e3'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Omitting listings, sharing, invitations, consent, conversations, and delivery outcomes makes the official onboarding demo visibly incomplete and less credible than the product.

**Approach:** Seed a manifest-backed, per-customer demo bundle containing a primary household, isolated companion shadchanus/collaborator contexts, and private synthetic counterpart actors. The customer keeps their normal login and can preview each context; real domain lifecycles run inside the bundle while hard containment prevents marketplace pollution or outbound communication.

## Boundaries & Constraints

**Always:** Preserve `OnboardingChoice → addPersona("parent") → seedDemo() → query invalidation → TourAutostart`; leave the primary household active; keep the customer's normal login as the only exposed credential; register every companion account, internal actor, storage object and simulated outcome in a server-owned run manifest; keep all people fictional adults and every shidduch woman–man; use local synthetic media, `.invalid` actor addresses, dynamic dates, random high-entropy tokens, strict bundle/tenant scoping, compensating cleanup, and bundle-wide clear/reseed.

**Ask First:** Any exposed or reusable synthetic credentials, real external send, globally discoverable demo listing, billing/Stripe or AI-result simulation, weakened RLS/privacy/reveal behavior, or runtime paid/network dependency.

**Never:** Contact real recipients; publish demo listings to ordinary anonymous search; expose one customer's bundle to another; return synthetic actor credentials to the browser; disguise simulated events as production delivery; use real PII beyond the customer's existing identity, scraped media, under-18 candidates, or same-sex suggestions; leave companion accounts/users, memberships, files, tokens, or active context behind after clear.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| First exploration | New authenticated customer with no context | Primary household plus connected shadchanus/collaborator contexts, full showcase data, normal shell and tour | Partial bundle is compensating-cleared and remains retryable |
| Role switch | Customer selects another demo context | Real RLS-backed shadchan, connection, grant, discussion and listing views appear | Non-bundle context access is denied |
| Public/outbound scenario | Listing search, share link, message or reminder delivery | Listing is bundle-preview-only; share serves an immutable synthetic snapshot; delivery settles `sent` with `simulated=true` and no provider call | Fail closed before public indexing, live-row exposure or dispatch |
| Clear/reseed | Clear from any bundle context or operator refresh | Active context returns to primary; all bundle rows/storage and companion accounts are removed; primary is released or reseeded | Demo flags/bundle metadata change last |

</frozen-after-approval>

## Code Map

- `supabase/schemas/{01_tables,02_functions,04_triggers,05_policies,06_grants}.sql` -- service-only `demo_runs`, `demo_run_accounts`, `demo_run_users`, `demo_run_storage`, `demo_share_snapshots`; receipt flags, helpers and containment RLS.
- `supabase/functions/_shared/demoDataset.ts` -- canonical core and full-product scenario graph shared with FakeRest where practical.
- `supabase/functions/{seed_demo,clear_demo}/index.ts` and `_shared/resolveDemoAccount.ts` -- bundle creation, ID resolution, storage and compensating cleanup.
- `supabase/functions/admin_reseed_demo_accounts/*` -- operate once per primary bundle, not once per companion account.
- `workers/{cron,share,ingest}/*` -- suppress dispatch/ingest, label simulation and serve only immutable synthetic share snapshots.
- `src/components/atomic-crm/{layout,tour,listings,sharing,reminders}/` -- explain sandboxing, expose context/public-preview scenarios and label simulation honestly.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.ts` -- align overlapping fixtures with the official canonical graph.

## Tasks & Acceptance

**Execution:**
- [ ] Declarative schema + generated migration -- add the named manifest/snapshot tables and `simulated` on `message_notifications`, `task_notifications`, and `share_access_log`; hide demo listings from anon while allowing authenticated bundle preview; make notification triggers settle demo email/push without queueing providers; expose only sanitized `demo_delivery_history()`.
- [ ] `demoDataset.ts` -- define detailed profiles, histories, inbox/analytics, pending/accepted/revoked invitations, private single content, listings/withdrawal, share links/access, connections/grants, discussions/messages, reminders and simulated receipts with key-based dependencies.
- [ ] `seed_demo/index.ts` -- create registered companion contexts and browser-inaccessible synthetic actors, run real invitation/acceptance/connection/grant/thread lifecycles with actor-scoped clients, grant the customer preview memberships, retain the primary context, and report exact counts.
- [ ] `clear_demo`, resolver and admin reseed -- resolve the run from any active context, lock and delete manifest resources in dependency-safe order, restore context before companion deletion, recover partial seeds, remove synthetic auth users last, and reseed only roots.
- [ ] Workers and UI -- make outbound/ingest suppression defense-in-depth, serve active demo links from immutable snapshots, expose sanitized delivery history, add subtle “Simulated” labels and teach the tour/context switcher how to reach every scenario.
- [ ] Tests -- cover bundle graph integrity, straight-only invariants, cross-bundle denial, anon listing exclusion, zero provider calls, simulated receipts, active share behavior, partial-failure recovery and repeated seed/clear.
- [ ] Hosted Supabase -- generate/check the migration, deploy, perform the authorized reset, verify via a disposable normal onboarding login, then remove the verification bundle and obsolete showcase login.

**Acceptance Criteria:**
- Given a new customer, when they explore the demo and switch contexts, then every major CRM, consent, communication, listing, sharing, inbox, reminder and analytics surface contains coherent linked data under their one normal login.
- Given any demo public/outbound path, when exercised, then the UI shows a realistic successful scenario while tests prove no ordinary marketplace row or email/push provider call escaped the bundle.
- Given clear or reseed from any bundle context, when complete, then no companion account, membership, domain row, storage object or stale active-context reference survives.

### Review Findings

- [ ] [Review][Patch] Generate the complete deployable migration and install the final exact simulation predicates, policies, grants, and lifecycle RPCs [supabase/schemas/02_functions.sql:5617]
- [ ] [Review][Patch] Move the authoritative empty-account assertion into the account-row-locked seed transaction [supabase/schemas/02_functions.sql:5626]
- [ ] [Review][Patch] Validate the complete account manifest and prevent one account from belonging to more than one unfinished run [supabase/functions/clear_demo/index.ts:421]
- [ ] [Review][Patch] Verify synthetic Auth identity metadata and all memberships before deleting an actor globally [supabase/functions/clear_demo/index.ts:661]
- [ ] [Review][Patch] Make storage registration lease-fenced and restrict every bucket and path to a manifest account [supabase/functions/seed_demo/index.ts:1939]
- [ ] [Review][Patch] Bind immutable demo share snapshots to the exact share link, active run, and account, and reject path-backed demo snapshots [workers/share/index.ts:190]
- [ ] [Review][Patch] Restore real member active-context state before deleting companion accounts so failed clears remain retryable [supabase/functions/clear_demo/index.ts:728]
- [ ] [Review][Patch] Register every simulated share, inbox, analytics, message, and reminder outcome in the run manifest [supabase/functions/seed_demo/index.ts:1603]
- [ ] [Review][Patch] Expose the Klein, Feldman, and Gross contexts with matching memberships in FakeRest [src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.ts:1037]
- [ ] [Review][Patch] Reset FakeRest to the primary context and regenerate bearer tokens and expiries on every clear and reseed [src/components/atomic-crm/providers/fakerest/dataProvider.ts:2200]
- [ ] [Review][Patch] Reconcile a committed temporary reseed Auth user when the create response is lost [supabase/functions/admin_reseed_demo_accounts/tempUser.ts:19]
- [ ] [Review][Patch] Treat packed generated assets as the canonical immutable bytes [supabase/functions/seed_demo/assets/manifest.ts:13]
- [ ] [Review][Patch] Model message delivery as its own scenario kind and validate the exact official scenario inventory [supabase/functions/_shared/demoDataset.ts:724]
- [ ] [Review][Patch] Execute and retain proof of the local and hosted seed, switch, share, clear, and reseed lifecycle, ending with an empty hosted project [_bmad-output/implementation-artifacts/spec-official-onboarding-demo-seed.md:105]
- [ ] [Review][Patch] Persist the explicit opposite gender on every Edge and FakeRest suggestion so the stored graph itself proves every shidduch is woman-man [supabase/functions/seed_demo/index.ts:2370]
- [ ] [Review][Patch] Reconcile a pending actor intent by exact email and run-scoped Auth metadata during clear so an Auth-create response-loss window cannot orphan a user or run [supabase/functions/clear_demo/index.ts:421]
- [ ] [Review][Patch] Atomically register runtime simulated share-access, message-notification, and reminder receipts in the owning run manifest [supabase/schemas/02_functions.sql:2703]
- [ ] [Review][Patch] Generate all FakeRest showcase dates relative to the current demo run, including task and receipt dates [src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.ts:9]
- [ ] [Review][Patch] Fail closed before provider dispatch whenever a notification originates from or touches a demo account, including mixed production-demo connections [supabase/schemas/02_functions.sql:2186]
- [ ] [Review][Patch] Block or atomically contain customer-created invites, connection invites, and grants while a demo run is active so no external relationship row can survive clear [supabase/schemas/02_functions.sql:1663]
- [ ] [Review][Patch] Make failed-run cleanup and retry reachable from onboarding instead of trapping the customer behind OnboardingGate [src/components/atomic-crm/login/OnboardingChoice.tsx:121]
- [ ] [Review][Patch] Treat account_not_empty as a non-seed outcome rather than enabling the tour and reporting demo success [src/components/atomic-crm/login/OnboardingChoice.tsx:135]
- [ ] [Review][Patch] Reconcile an already-active exact run as success after a lost seed response [supabase/functions/seed_demo/index.ts:2901]
- [ ] [Review][Patch] Make release clear idempotent after a lost final HTTP response even when the bootstrap membership and active context were already released [supabase/functions/clear_demo/index.ts:1237]
- [ ] [Review][Patch] Transactionally assert the exact three-context official graph and required actor/resource inventory before activation or destructive clear [supabase/migrations/20260823140000_official_demo_retry_and_onboarding.sql:336]
- [ ] [Review][Patch] Prevent concurrent customer writes during seeding or clearing from being mistaken for demo rows and deleted by compensation [supabase/schemas/02_functions.sql:5843]
- [ ] [Review][Patch] Add database-side ownership assertions around every service-role cleanup target and correct the obsolete user-scoped deletion contract [supabase/functions/clear_demo/index.ts:9]
- [ ] [Review][Patch] Return stable client-safe seed and clear errors while retaining detailed diagnostics only in server logs [supabase/functions/seed_demo/index.ts:2967]
- [ ] [Review][Patch] Update final-schema and migration replay tests to cover the latest dispatch semantics and exact Klein-Feldman-Gross graph [supabase/tests/official_demo_bundle.test.ts:57]
- [ ] [Review][Patch] Await and fail-soft the ordinary own-family intent cancellation so navigation cannot leave a durable retry intent behind [src/components/atomic-crm/login/OnboardingChoice.tsx:62]
- [ ] [Review][Patch] Cancel or ignore an in-flight automatic photo signing request when click-to-reveal becomes enabled so privacy preference changes cannot display a photo without a click [src/components/atomic-crm/resumes/PhotoRevealCard.tsx:43]
- [ ] [Review][Patch] Remove the accidental untracked --help Supabase configuration artifact before delivery [--help:1]
- [ ] [Review][Patch][r17] Delete manifest-owned synthetic actor member-state rows during normal and partial cleanup, then assert none survive [supabase/functions/clear_demo/index.ts:1275]
- [ ] [Review][Patch][r17] Let active clear tolerate customer-deleted demo rows while retaining exact activation inventory and manifest-containment checks [supabase/schemas/02_functions.sql:6804]
- [ ] [Review][Patch][r17] Reject simulated receipts whose connection endpoints touch different demo runs instead of silently leaving them unregistered [supabase/schemas/02_functions.sql:283]
- [ ] [Review][Patch][r17] Reconcile a committed activation through independent exact run and root reads when either response is lost [supabase/functions/seed_demo/index.ts:466]
- [ ] [Review][Patch][r17] Make onboarding failure marking best-effort so partial bundle compensation always executes after a transport exception [supabase/functions/seed_demo/index.ts:3112]
- [ ] [Review][Patch][r17] Reconcile a uniquely marked temporary reseed Auth user after retryable returned API errors as well as thrown response loss [supabase/functions/admin_reseed_demo_accounts/tempUser.ts:82]
- [ ] [Review][Patch][r17] Serialize FakeRest demo lifecycle operations and roll back graph replacement atomically on any collection mutation failure [src/components/atomic-crm/providers/fakerest/dataProvider.ts:390]
- [ ] [Review][Patch][r17] Preserve the original ingest attachment failure when compensating storage removal also fails, with complete storage mocks and regression coverage [workers/ingest/attachments.test.ts:169]
- [ ] [Review][Patch][r17] Apply repository formatting to the new official-demo source test so the lint gate passes [supabase/tests/official_demo_review_source.test.ts:93]
- [ ] [Review][Patch][r17] Execute and retain the full Stack 2 and hosted seed, switch, share, clear, reseed, and final-empty verification evidence [_bmad-output/implementation-artifacts/spec-official-onboarding-demo-seed.md:80]

## Design Notes

The bundle has three contexts: the primary Klein household, a connected shadchanus, and a collaborator household receiving a child grant. The customer receives preview-capable memberships; private per-run actors with random undisclosed credentials execute counterpart RPCs so accepted consent and two-party discussions are structurally real. Only the root keeps `accounts.demo=true`; a server helper recognizes companions through the active run. Demo listings use authenticated preview, share tokens serve immutable synthetic snapshots, and notification rows are real but explicitly simulated.

## Verification

**Commands:**
- `make check-migration-safety` -- pending migration preserves production-shaped data.
- `npm run test:unit:functions -- --run supabase/functions/_shared/demoDataset.test.ts supabase/functions/seed_demo/index.test.ts supabase/functions/clear_demo/index.test.ts supabase/functions/admin_reseed_demo_accounts` -- seed lifecycle passes.
- `npm run test:unit:workers -- --run workers/cron workers/share` -- containment and synthetic sharing pass.
- `npm run test:unit:app -- --run src/components/atomic-crm/login/OnboardingChoice.test.tsx src/components/atomic-crm/providers/fakerest/dataGenerator/showcase.test.ts` -- onboarding and parity pass.
- `make typecheck && make lint && make build` -- repository gates pass.

**Manual checks (if no CLI):**
- On hosted Supabase, onboard normally, traverse all three contexts and showcase surfaces, test the synthetic public share, clear from a companion context, and confirm onboarding reappears with no permanent demo login.
