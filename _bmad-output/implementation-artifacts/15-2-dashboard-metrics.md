# Story 15.2: Measure what the PRD said it would *(PRD §18)*

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **platform owner**,
I want the **north-star and counter-metrics to be collectable**,
So that **"families running their whole process in-app" is something we know rather than hope.**

## Acceptance Criteria

1. **Given** the events PRD §18 names — filing an item, confirming a duplicate or already-dated catch, logging a reference call, capturing via a channel, time-to-file
   **When** they happen
   **Then** each is recorded as a first-party event with no third-party analytics script, no cross-site identifier and nothing that would make PRV-2 or the sub-processor list of Story 14.1 false

2. **And** the counter-metrics are derivable: cross-account leak reports, mis-routed channel items, dismissed-duplicate-flags ÷ total-flags, trial→paid conversion, AI cost per active family

3. **And** no event carries a name, a phone number, a note body or a file

4. **And** the collection is visible to users where 14.1's policy says it is, and disableable if that policy says it is

## Why first-party and no third-party script

A product whose wedge is "your data is never shared" cannot ship a tag that ships behaviour to an ad network. This is not a preference; it is the same claim Story 14.1 has to write down.

## Tasks / Subtasks

- [ ] Task 1: Design first-party event schema and collection infrastructure (AC: #1, #2, #3)
  - [ ] Define event taxonomy matching PRD §18 metrics (north-star, value moments, adoption, sustainability, counter-metrics)
  - [ ] Create TypeScript event types with strict schema validation (Zod)
  - [ ] Ensure zero PII in event payloads (no names, phones, note bodies, files)
  - [ ] Design account-scoped event collection respecting RLS boundaries (AD-1)

- [ ] Task 2: Implement client-side event collection in SPA (AC: #1, #3, #4)
  - [ ] Create `analytics/eventCollector.ts` — first-party event queue with IndexedDB persistence for offline tolerance (AD-14)
  - [ ] Integrate with React Query mutations for automatic event emission on success
  - [ ] Add event sampling/batching to minimize network overhead
  - [ ] Implement user-visible privacy control per Story 14.1 policy (enable/disable collection)

- [ ] Task 3: Implement server-side event collection in Cloudflare Workers (AC: #1, #2)
  - [ ] Create `workers/analytics/` Worker for event ingestion
  - [ ] Implement `forAccount()` scoped client for tenant-isolated event storage (AD-7, AD-1)
  - [ ] Add rate limiting per AD-17 (per-account and per-IP token bucket via Upstash)
  - [ ] Ensure events never cross account boundaries (RLS-enforced)

- [ ] Task 4: Design and create analytics storage schema (AC: #1, #2)
  - [ ] Add `analytics_events` table to `supabase/schemas/01_tables.sql` with account_id, event_type, properties (JSONB), created_at
  - [ ] Add RLS policies with `FORCE ROW LEVEL SECURITY` scoped to `current_context_id()` (AD-1)
  - [ ] Generate and apply migration via `npx supabase db diff --local -f analytics_events`
  - [ ] Add `analytics_events_summary` view to `supabase/schemas/03_views.sql` for counter-metric derivation

- [ ] Task 5: Implement counter-metric derivation queries (AC: #2)
  - [ ] Create Postgres functions for each counter-metric:
    - `cross_account_leak_reports()` — should always return 0
    - `misrouted_channel_items()` — count of inbox_items with attribution issues
    - `duplicate_flag_false_positive_rate()` — dismissed_duplicate_flags / total_flags
    - `trial_to_paid_conversion()` — from `accounts` billing state
    - `ai_cost_per_active_family()` — from `ai_usage_meter` and active accounts
  - [ ] Expose via `analytics/` Worker endpoints for dashboard consumption

- [ ] Task 6: Build dashboard metrics display (AC: #1, #2, #4)
  - [ ] Add metrics cards to existing dashboard (`src/components/atomic-crm/dashboard/`)
  - [ ] Use `dataProvider` custom method for metrics queries (AD-10)
  - [ ] Mirror in FakeRest provider for demo mode
  - [ ] Respect user privacy setting — hide metrics if collection disabled

- [ ] Task 7: Integrate with PostHog for error/survey tracking only (AC: #1, #4)
  - [ ] Configure PostHog (`posthog-js` 1.406.1) for error capture and replay only
  - [ ] Disable all autocapture and property collection
  - [ ] Ensure PostHog never receives PII or cross-site identifiers
  - [ ] Add to `src/components/atomic-crm/providers/supabase/` initialization

- [ ] Task 8: Add privacy policy disclosure and user control (AC: #4)
  - [ ] Update Settings page with "Analytics Collection" toggle
  - [ ] Link to privacy policy section explaining what is collected
  - [ ] Ensure toggle state persists per account and respects Story 14.1 policy
  - [ ] Add i18n keys for Hebrew/English (AD-18)

- [ ] Task 9: Testing and validation (AC: all)
  - [ ] Unit tests for event schema validation
  - [ ] Integration tests for cross-account isolation (RLS test suite per AD-1)
  - [ ] E2E tests for event flow: SPA → Worker → DB → Dashboard
  - [ ] Verify zero PII in collected events (automated scan)
  - [ ] Verify counter-metrics derive correctly from seeded data
  - [ ] Test privacy toggle disables collection end-to-end

## Dev Notes

### Project Structure Alignment

- **New files to create:**
  - `src/components/atomic-crm/analytics/` — new domain folder for analytics components
  - `src/components/atomic-crm/analytics/eventCollector.ts` — client-side event queue
  - `src/components/atomic-crm/analytics/types.ts` — Zod-validated event schemas
  - `src/components/atomic-crm/analytics/privacyControl.tsx` — user-facing toggle
  - `src/components/atomic-crm/dashboard/MetricsCards.tsx` — dashboard display
  - `workers/analytics/` — Cloudflare Worker for event ingestion
  - `workers/analytics/index.ts` — Hono app with `/events` POST and `/metrics` GET
  - `workers/analytics/deriveMetrics.ts` — counter-metric computation
  - `supabase/schemas/01_tables.sql` — add `analytics_events` table
  - `supabase/schemas/03_views.sql` — add `analytics_events_summary` view
  - `src/components/atomic-crm/providers/supabase/analytics.ts` — dataProvider custom methods
  - `src/components/atomic-crm/providers/fakerest/analytics.ts` — FakeRest mirror

- **Files to modify:**
  - `src/components/atomic-crm/settings/SettingsPage.tsx` — add privacy toggle
  - `src/components/atomic-crm/providers/supabase/index.ts` — register analytics custom methods
  - `src/components/atomic-crm/providers/fakerest/index.ts` — register FakeRest analytics
  - `src/components/atomic-crm/root/CRM.tsx` — initialize event collector
  - `src/components/ui/` — may need new UI primitives for metrics display
  - `src/lib/i18n/` — add Hebrew/English keys for analytics privacy strings

### Architecture Compliance (from ARCHITECTURE-SPINE.md)

| AD | Requirement | Implementation Note |
|----|-------------|---------------------|
| AD-1 | Tenant isolation + FORCE RLS | `analytics_events` table must have `account_id` + RLS; Worker uses `forAccount()` |
| AD-7 | Workers = compute home | Event ingestion in `workers/analytics/` (Hono + `forAccount()`) |
| AD-8 | AI tracing via Langfuse | Not directly applicable, but analytics Worker should emit traces |
| AD-10 | dataProvider = single CRUD seam | Custom methods for metrics; mirror in FakeRest |
| AD-14 | Offline-tolerant capture | Event collector uses IndexedDB outbox |
| AD-17 | Rate limiting on expensive surfaces | Upstash token-bucket per-account + per-IP on `/events` endpoint |
| AD-18 | i18n + RTL | All UI strings via `i18nProvider`; logical CSS properties |
| AD-23 | Entity naming | `analytics_events` follows snake_case plural convention |

### Critical Technical Requirements

1. **Zero PII guarantee**: Event schemas must be validated at ingest (Worker) to reject any payload containing name-like, phone-like, or free-text fields. Use Zod schemas with strict `rejectUnknownKeys`.

2. **First-party only**: No third-party analytics scripts. PostHog is used **only** for error tracking + replay + surveys (per addendum.md:63), with autocapture disabled. The metrics collection is entirely homegrown.

3. **Account-scoped everything**: Every event carries `account_id` derived from `current_context_id()` (AD-19). The Worker's `forAccount()` client enforces this. RLS on `analytics_events` is the backstop.

4. **Counter-metrics derivable from events**: The `analytics_events_summary` view and Postgres functions must make all five counter-metrics queryable without raw event access.

5. **Privacy toggle per Story 14.1**: Collection visibility and disablement must align with whatever policy Story 14.1 establishes. The toggle lives in Settings and gates the event collector at the source.

6. **Offline tolerance (AD-14)**: Event collector queues to IndexedDB and syncs in background — never blocks UI.

7. **Rate limiting (AD-17)**: `/events` endpoint protected by Cloudflare WAF + Turnstile + Upstash token-bucket (per-account + per-IP). Fail-closed on paid paths (not applicable here but pattern applies).

### Database Schema Changes

```sql
-- In supabase/schemas/01_tables.sql (add to appropriate alphabetical position)
CREATE TABLE analytics_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- e.g., 'item_filed', 'duplicate_confirmed', 'reference_call_logged', 'channel_capture', 'time_to_file'
  properties JSONB NOT NULL DEFAULT '{}', -- structured, PII-free properties
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS (same migration)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY;

CREATE POLICY analytics_events_select ON analytics_events
  FOR SELECT USING (account_id = current_context_id());
CREATE POLICY analytics_events_insert ON analytics_events
  FOR INSERT WITH CHECK (account_id = current_context_id());
-- No UPDATE/DELETE policies — events are append-only

-- Index for time-series queries
CREATE INDEX analytics_events_account_created ON analytics_events (account_id, created_at DESC);
```

```sql
-- In supabase/schemas/03_views.sql
CREATE OR REPLACE VIEW analytics_events_summary WITH (security_invoker = on) AS
SELECT
  account_id,
  COUNT(*) FILTER (WHERE event_type = 'item_filed') AS items_filed,
  COUNT(*) FILTER (WHERE event_type = 'duplicate_confirmed') AS duplicates_confirmed,
  COUNT(*) FILTER (WHERE event_type = 'reference_call_logged') AS reference_calls_logged,
  COUNT(*) FILTER (WHERE event_type = 'channel_capture') AS channel_captures,
  AVG(properties->>'time_to_file_ms')::BIGINT FILTER (WHERE event_type = 'time_to_file') AS avg_time_to_file_ms,
  COUNT(*) AS total_events
FROM analytics_events
GROUP BY account_id;
```

### Event Taxonomy (from PRD §18)

| Event Type | Trigger | Properties (PII-free) |
|------------|---------|------------------------|
| `item_filed` | User files inbox_item → suggestion | `{ suggestion_id, candidate_id, source_channel }` |
| `duplicate_confirmed` | User confirms duplicate/already-dated flag | `{ suggestion_id, matched_suggestion_id, flag_type }` |
| `reference_call_logged` | User logs a reference call | `{ reference_link_id, suggestion_id, call_status }` |
| `channel_capture` | Inbox item created via channel | `{ inbox_item_id, channel_type, has_attachment }` |
| `time_to_file` | Inbox item filed (measure capture→file latency) | `{ inbox_item_id, time_to_file_ms }` |

### Counter-Metric Derivation

| Counter-Metric | Source | Derivation |
|----------------|--------|------------|
| Cross-account leak reports | `analytics_events` + audit log | Should always be 0; alert if >0 |
| Mis-routed channel items | `inbox_items` | Count where `detected_shadchan` confidence < threshold OR unattributed queue |
| False-positive duplicate rate | `analytics_events` | `dismissed_duplicate_flags / total_duplicate_flags` from event properties |
| Trial→paid conversion | `accounts` (billing cols) | `COUNT(active_subscriptions) / COUNT(trial_started)` |
| AI cost per active family | `ai_usage_meter` + `accounts` | `SUM(ai_cost) / COUNT(active_accounts)` |

### Library/Framework Requirements

| Library | Version | Purpose |
|---------|---------|---------|
| `zod` | 4.4.3 | Event schema validation (already in stack) |
| `@supabase/supabase-js` | 2.110.8 | Worker `forAccount()` client |
| `hono` | 4.x | Worker router (AD-7 assumption) |
| `posthog-js` | 1.406.1 | Error tracking only (autocapture off) |
| `@langfuse/*` | 5.9.1 | Worker tracing (AD-8) |
| `idb` or native IndexedDB | - | Offline event queue (AD-14) |

### Testing Standards (from Architecture Consistency Conventions)

- **≥80% new-code coverage** (Vitest)
- **AAA pattern** (Arrange-Act-Assert)
- **RLS test suite per table** — include cross-account attempts from a Worker
- **FakeRest fixtures updated** per resource (analytics events + metrics)
- **Playwright deterministic waits** for E2E
- **No `console.log` in prod** — structured logging only

### Previous Story Intelligence (Story 15.1: "Know when it breaks")

Story 15.1 implemented error tracking and alerting across SPA, Workers, and Edge Functions. Key learnings:
- **Worker observability pattern**: Cloudflare Workers native logs + `requestTracing.ts` request IDs
- **Alert infrastructure**: Named recipients, documented responses, proven by deliberate failure
- **Cron health signals**: `cron_heartbeat` extended with delivery-health
- **No PII in errors**: Account ID yes, never payload/resume text/JWT/Stripe secrets
- **Pattern to reuse**: The `workers/shared/requestTracing.ts` correlation ID pattern applies to analytics events for traceability

### Git Intelligence (Recent Commits)

Recent commits show patterns relevant to this story:
- Worker creation pattern: `workers/<domain>/index.ts` with Hono + `forAccount()` + Zod validation
- Database migration pattern: `npx supabase db diff --local -f <name>` → `migration up --local`
- dataProvider custom method pattern: `providers/supabase/<domain>.ts` + `providers/fakerest/<domain>.ts`
- i18n key pattern: `resources.<domain>.<key>` in both `public/locales/en/*.json` and `he/*.json`
- Registry generation: automatic via `.husky/pre-commit` on file changes under `src/components/atomic-crm/**`

### Latest Technical Specifics

- **PostHog 1.406.1**: Configure with `autocapture: false`, `disable_session_recording: true` for privacy mode; enable only for error tracking + surveys
- **Zod 4.4.3**: Use `strictObject` for event schemas to reject unknown keys (PII guard)
- **Cloudflare Workers + Hono 4.x**: `compatibility_date=2026-07-21`, `nodejs_compat` enabled
- **Upstash Redis token-bucket**: `@upstash/ratelimit` + `@upstash/redis` for per-account limits
- **IndexedDB offline queue**: Use `idb` library (lightweight wrapper) for event persistence

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Project Context Reference

- **Epic**: 15 — Run It For Real (added 2026-08-09 by Phase-1 completeness audit)
- **PRD Section**: §18 Success Metrics & Counter-metrics
- **Architecture**: ARCHITECTURE-SPINE.md (AD-1, AD-7, AD-8, AD-10, AD-14, AD-17, AD-18, AD-23)
- **Solution Design**: SOLUTION-DESIGN.md (PostHog for errors only, first-party analytics)
- **Addendum**: addendum.md:63 (PostHog powers §18 metrics incl. child sentiment)
- **Story 14.1 Policy**: Privacy policy governs visibility/disablement of collection
- **Stack**: React 19 + TypeScript + Vite, Supabase (Postgres + RLS), Cloudflare Workers (Hono), PostHog, Upstash