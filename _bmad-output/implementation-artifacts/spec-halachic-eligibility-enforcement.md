---
title: 'Halachic eligibility and actor-access enforcement'
type: 'feature'
created: '2026-08-21'
status: 'done'
review_loop_iteration: 0
baseline_commit: '35703a85291c551459076a057b788bf511670c2a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The application currently relies on forms and workflow conventions for straight-shidduch rules, while direct Supabase writes, later edits, AI-resolved inbox items, and FakeRest can bypass them. It also does not consistently support the permitted actors: standalone shadchanim, singles managing themselves, and people granted access to a child.

**Approach:** Make only clear, explicit halachic conflicts and account/role ownership enforceable at the database boundary, revalidate existing matches when relevant records change, and mirror the same quiet decision in the Supabase provider, FakeRest provider, AI-resolve flow, and UI. Unknown or non-standard facts remain permissible; the product does not attempt to supervise or certify them. Preserve least privilege while enabling the three stated actor types, then verify and deploy the complete change.

## Boundaries & Constraints

**Always:** When both genders are explicitly known, a same-gender pairing is blocked. A known Kohen cannot be matched with a clearly identified divorcee in either direction. Unknown, incomplete, or non-standard facts may be stored and used; do not infer or label them. All writes and reads remain account-scoped; shadchan attribution must belong to the same account. Existing matches cannot be made invalid by later edits. Search, identity, suggestion, import, AI-promotion, generic/MCP mutation, and FakeRest paths must apply only the same clear-conflict decision. Standalone shadchan, self-managed single, and accepted child-grant workflows must work only within their permitted ownership/access scope. Database RLS/triggers/functions are authoritative; client checks are usability only.

**Ask First:** None. The actor model and halachic constraints are explicit in the request and prior audit.

**Never:** Do not weaken RLS to make the UI work, permit a clear explicit same-gender or Kohen-divorce conflict, infer missing halachic facts from AI, add prominent supervision or certification UX, expose unrelated accounts through FakeRest, reset production or local data destructively, or modify the separate demo-data/photo work another agent owns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid match | Active target single plus explicit opposite candidate gender and known statuses | Create/update succeeds | N/A |
| Same gender | Male target and male candidate, or female/female | No row is created or changed | Quiet, stable eligibility error |
| Kohen/divorce | Either side explicitly Kohen and the other explicitly divorced | No row is created or changed | Quiet, stable eligibility error |
| Unknown facts | Missing/unknown gender, marital status, or Kohen status with no known conflict | Record and workflow remain allowed; no halachic-validity claim is added | Preserve unknown; reject only if another known field creates a conflict |
| Post-match edit | An edit would make an existing match invalid | Edit is rejected; valid existing row remains | Stable eligibility error |
| Actor scope | Standalone shadchan, self-owned single, or accepted child grant acts in scope | Only allowed owned/granted records are readable/writable | RLS/provider denial |
| Forged attribution | Shadchan ID from another account | Write is rejected | FK/RLS denial |

</frozen-after-approval>

## Code Map

- `supabase/schemas/01_tables.sql` -- eligibility fields and same-account foreign-key shape.
- `supabase/schemas/02_functions.sql` -- create/transition, eligibility, context, and child-grant authority.
- `supabase/schemas/04_triggers.sql` -- database write-time and post-match revalidation hooks.
- `supabase/schemas/05_policies.sql` / `supabase/schemas/06_grants.sql` -- actor and account RLS/API permissions.
- `supabase/functions/mcp/` and `src/components/atomic-crm/shadchanim/` -- generic mutation and suggestion/search paths that must not bypass compatibility.
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` -- RPC and direct-write boundary.
- `src/components/atomic-crm/providers/fakerest/` -- demo provider authorization, scoping, and parity.
- `src/components/atomic-crm/inbox/` and `workers/parse/` -- AI draft fields and explicit confirmation path.
- `src/components/atomic-crm/types.ts`, `singles/`, `shidduchim/`, `root/`, `layout/` -- typed fields, forms, routes, and actor navigation.

## Tasks & Acceptance

**Execution:**
- [ ] Add canonical eligibility data, authoritative known-conflict validation, revalidation triggers, and same-account shadchan FKs -- make direct SQL/API writes reject explicit conflicts.
- [ ] Update RLS, grants, context routes, and navigation for standalone shadchanim, self-managed singles, and accepted child grants -- preserve least privilege.
- [ ] Align Supabase provider, MCP mutation/search, FakeRest provider, AI parsing/resolution, types, and forms -- preserve unknown facts while rejecting known conflicts.
- [ ] Add regression tests for every matrix row, including multi-account isolation and post-match edits -- prevent future bypasses.
- [ ] Run migration safety, typecheck, tests, lint, build, Supabase deployment, and Vercel production deployment -- verify the live domain.

**Acceptance Criteria:**
- Given any direct authenticated table write or RPC call, when a known gender/Kohen/divorce conflict, ownership, or actor-scope violation exists, then the database rejects it.
- Given an opposite-sex pair or a pair with incomplete facts and no known conflict, when an authorized actor creates or updates a match, then the operation succeeds in Supabase and FakeRest.
- Given an existing valid match, when either participant is edited into an incompatible state, then the edit is rejected and the match is unchanged.
- Given a generic/MCP write or a suggestion/search request, when the pair has a known conflict, then the write is rejected and the result is excluded; incomplete facts are not treated as a conflict.
- Given each supported actor type, when it acts within its owned/granted account, then permitted workflows work without granting unrelated-account access.
- Given the production deployment, when the landing page, login, onboarding, and authorized pipeline are exercised, then they render and complete without a blank/hanging state.

## Spec Change Log

## Verification

**Commands:**
- `make check-migration-safety` -- expected: seeded production-shaped rows survive pending migrations.
- `make typecheck` -- expected: no TypeScript errors.
- `make test` -- expected: all unit/regression tests pass.
- `make lint` -- expected: lint and formatting checks pass.
- `make build` -- expected: production bundle succeeds.
- `npx supabase db push` and `vercel --prod` -- expected: database and Vercel deployment complete.

## Suggested Review Order

**Eligibility decision and write-time authority**

- Start with the narrow predicate: only explicit recognized conflicts are blocked.
  [`02_functions.sql:2108`](../../supabase/schemas/02_functions.sql#L2108)

- Review concurrency-safe triggers that reject invalid creates and later profile edits.
  [`02_functions.sql:2166`](../../supabase/schemas/02_functions.sql#L2166)

- Confirm the new facts preserve unknown values and match physical database column order.
  [`01_tables.sql:472`](../../supabase/schemas/01_tables.sql#L472)

**Database visibility and actor scope**

- Check the canonical RLS predicates that hide legacy conflicts and reject conflicting writes.
  [`05_policies.sql:472`](../../supabase/schemas/05_policies.sql#L472)

- Follow summary, catch, and identity-search filtering for read-path parity.
  [`03_views.sql:20`](../../supabase/schemas/03_views.sql#L20)

- Verify least-privilege grants and the deployed follow-up ACL/concurrency migration.
  [`20260823010000_halachic_eligibility_read_parity.sql:1`](../../supabase/migrations/20260823010000_halachic_eligibility_read_parity.sql#L1)

**Provider and route parity**

- Inspect FakeRest’s account, grant, single, interaction, and eligibility visibility reconstruction.
  [`dataProvider.ts:470`](../../src/components/atomic-crm/providers/fakerest/dataProvider.ts#L470)

- Compare the client mirror with the database predicate and stable quiet error.
  [`halachicEligibility.ts:30`](../../src/components/atomic-crm/providers/fakerest/internal/halachicEligibility.ts#L30)

- Confirm standalone shadchan and self-managed-single routes are registered without widening household-only surfaces.
  [`routeManifest.ts:181`](../../src/components/atomic-crm/root/routeManifest.ts#L181)

**Verification and deployment evidence**

- Review the database regression covering explicit conflicts and permitted unknown facts.
  [`halachic_eligibility.test.ts:32`](../../supabase/tests/halachic_eligibility.test.ts#L32)

- Review the RPC boundary that carries candidate facts to the authoritative database function.
  [`dataProvider.ts:135`](../../src/components/atomic-crm/providers/supabase/dataProvider.ts#L135)
