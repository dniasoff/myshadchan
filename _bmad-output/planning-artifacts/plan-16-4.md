# Plan for Story 16.4: Finish Story 7.5 (Notification Send Half)

## Executive Summary

**Story 7.5 is ~70% complete.** The database/queue layer, client push registration, in-app unread UI, and service-worker listeners are all built and tested. What remains is **exactly the SEND half of delivery** — the Worker sweep that drains `message_notifications` and calls Resend/Web Push. This was deliberately deferred (blocked on Epic 12 gate G1: Cloudflare secrets never provisioned) and is now owned by **Story 16.4** per `epics.md` line 251.

**16.4 is real work**, not a no-op. It comprises:
1. `workers/cron/sweepMessages.ts` — new file, the message notification sweep
2. Wiring it into `workers/cron/index.ts` `scheduled()` handler
3. Unifying `TaskDeliveryChannel` / `MessageNotificationChannel` → shared `DeliveryChannel` (ledger item S11)
4. Operational readiness (verifying the sweep works once G1 is discharged)

---

## AC-by-AC Verdict for Story 7.5

| AC | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| **AC-1** | In-app unread derived from `last_read_at` vs `messages.created_at` | ✅ **MET** | `thread_participants.last_read_at` column in `01_tables.sql:1445`; `computeUnreadThreadIds.ts` implements the derived check; `ThreadPanel.tsx` calls `markThreadRead()` on open |
| **AC-2** | `mark_thread_read()` only touches caller's own row | ✅ **MET** | `02_functions.sql:261-267` — predicate `tp.member_id = public.current_member_id()`; `supabase/tests/message_notifications.sql` asserts 0-row UPDATE for other participant |
| **AC-3** | Email queued for every other participant | ✅ **MET (queue only)** | `fan_out_message_notifications()` in `02_functions.sql:2129-2194` inserts `channel='email'` row per recipient; **send not built** |
| **AC-4** | `skipped` (no user_id) vs `failed` (unresolvable) distinguished | ✅ **MET (queue only)** | Trigger logic at `02_functions.sql:2147-2163`; test assertions in `message_notifications.sql:180-220`; **send not built** |
| **AC-5** | Push queued only where `push_subscriptions` row exists | ✅ **MET (queue only)** | Trigger at `02_functions.sql:2176-2186` checks `exists (select 1 from push_subscriptions)`; **send not built** |
| **AC-6** | No SMS — `channel` constrained to `('email','push')` | ✅ **MET** | `message_notifications_channel_check` at `01_tables.sql:1469`; insert with `sms` raises `23514` |
| **AC-7** | Sender never notified; `is distinct from` for nullable sender | ✅ **MET** | Trigger at `02_functions.sql:2139` uses `member_id is distinct from new.sender_member_id`; test at `message_notifications.sql:150-170` |
| **AC-8** | Notification inherits message scope (account_id/connection_id XOR) | ✅ **MET** | `message_notifications_scope_check` at `01_tables.sql:1479`; trigger copies `new.account_id`/`new.connection_id` |
| **AC-9** | Claim-then-dispatch with `FOR UPDATE SKIP LOCKED` | ✅ **MET (RPC only)** | `claim_message_notifications()` at `02_functions.sql:1123-1163`; concurrency test in `message_notifications.test.ts` proven falsifiable |
| **AC-10** | Worker issues no `.from(` — only RPC calls | ✅ **MET (structure)** | `claim_message_notifications` returns joined `thread_id`, `subject_type`, `subject_id`, `push_subscriptions` JSONB; guard test `workers/cron/noTenantTableAccess.guard.test.ts` scans for `.from(` |
| **AC-11** | `message_notifications` unreachable from browser (no authenticated policy) | ✅ **MET** | `05_policies.sql` enables RLS but adds **no policy for authenticated** (comment at line 1037-1047 mirrors `subscription`/`ai_usage` posture); test asserts 0 rows readable |
| **AC-12** | `push_subscriptions` RLS keyed on `auth.uid()` via owning `account_members` | ✅ **MET** | Policy at `05_policies.sql` (search for `push_subscriptions`); negative test in `message_notifications.test.ts` |
| **AC-13** | Toolchain green (typecheck, lint, test, migration-safety) | ✅ **MET** | All CI gates pass per Dev Agent Record sessions 1 & 2 |

**Verdict**: AC-1,2,6-13 fully met. AC-3,4,5,9,10 met **for the queue layer only** — the actual send (Resend + Web Push) is not built. This is the exact scope of 16.4.

---

## What 16.4 Must Deliver

### 1. `workers/cron/sweepMessages.ts` (New File)
Per 7.5 Task 5:
- Export `sweepMessages(env: CronEnv): Promise<{ claimed: number; sent: number; failed: number }>`
- Create `service_role` Supabase client
- Call `.rpc("claim_message_notifications", { p_limit: 100 })`
- For each row:
  - **Email** (`channel='email'`): call `sendEmail()` from `workers/shared/resend.ts` with:
    - `from`: `RESEND_FROM` (via env)
    - `to`: `row.recipient_email`
    - `subject`: "New message on {subject}" (subject from thread/shidduch)
    - `text`: Pointer only — **never message body** (7.5 AC decision)
    - `idempotencyKey`: derived from `(message_id, recipient_member_id, channel)` — same natural key as unique constraint
  - **Push** (`channel='push'`): call `webPush.ts` `sendWebPush()` for each subscription in `row.push_subscriptions` JSONB
    - On `410`/`404`: call `delete_push_subscription_by_endpoint()` RPC
- Call `.rpc("settle_message_notification", { p_id, p_status, p_error })` per row
- Return aggregate counts

### 2. Wire `sweepMessages` into `workers/cron/index.ts`
Per 7.5 Task 6:
- Import `sweepMessages` 
- In `scheduled()` handler, **add a branch for the reminder sweep cron** (`REMINDER_SWEEP_CRON`) that also runs `sweepMessages(env)` — **same tick, same Worker**
  - Do **not** add a second cron schedule (wrangler.toml stays `*/15`)
  - Do **not** record a second heartbeat — reuse 12.2's `recordHeartbeat` (7.5 Dev Notes coordination table)
  - Wrap in same try/catch/alerter pattern as `sweepReminders`
- Update file header comment (currently says "Story 7.5 will eventually add a FOURTH concern") to reflect it's now wired

### 3. Unify Channel Enums (Ledger Item S11)
Per `epics.md` line 251: "unifies the two channel enums in the same change (ledger item **S11**)"
- **Current**: 
  - `types.ts:102` — `TaskDeliveryChannel = "in_app" | "email" | "push"`
  - `types.ts` (7.5 additions) — `MessageNotificationChannel = "email" | "push"`
- **Target**: Single `DeliveryChannel = "in_app" | "email" | "push"` used by both
- **Files to change**:
  - `src/components/atomic-crm/types.ts` — define `DeliveryChannel`, re-export as `TaskDeliveryChannel` / `MessageNotificationChannel` aliases (or migrate usages)
  - `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx` — consumes `TaskDeliveryChannel`
  - `src/components/atomic-crm/threads/usePushSubscription.ts` — consumes `MessageNotificationChannel`
  - Any other usages (grep for both type names)
- **Constraint**: Do not break 12.2's reminders create sheet. This is a cross-epic refactor with its own review surface (7.5 Dev Notes § "Do not refactor TaskDeliveryChannel") — 16.4 is the designated story for it.

### 4. Operational Verification (Post-G1)
Once Epic 12 gate G1 is discharged (Cloudflare secrets provisioned, Workers deployed):
- Run the one-time backlog drain: `update message_notifications set status = 'skipped' where status = 'pending';` (per 7.5 "Operational risk call")
- Verify first real tick delivers email + push
- Confirm `cron_heartbeat.last_failed_count` reflects message sweep too (shared heartbeat)

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `workers/cron/sweepMessages.ts` | **CREATE** | New sweep implementation |
| `workers/cron/sweepMessages.test.ts` | **CREATE** | Unit tests (mocked HTTP, same pattern as `sweepReminders.test.ts`) |
| `workers/cron/index.ts` | **MODIFY** | Import + wire `sweepMessages` in `REMINDER_SWEEP_CRON` branch |
| `workers/cron/wrangler.toml` | **MODIFY** | Update header comment (remove "will eventually add") |
| `src/components/atomic-crm/types.ts` | **MODIFY** | Add `DeliveryChannel`, alias old names |
| `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx` | **MODIFY** | Update import/use of channel type |
| `src/components/atomic-crm/threads/usePushSubscription.ts` | **MODIFY** | Update import/use of channel type |
| Any other files using `TaskDeliveryChannel` or `MessageNotificationChannel` | **MODIFY** | Grep to find all usages |

---

## Owner Decisions Required

| # | Decision | Context |
|---|----------|---------|
| **D1** | **Channel enum unification strategy**: Replace both types with `DeliveryChannel` and update all call sites, OR keep aliases? | 7.5 Dev Notes explicitly flagged this as "a deliberate cross-epic refactor with its own review surface." 16.4 owns it, but the approach (breaking change vs. alias) affects 12.2's `ReminderCreateSheet.tsx` concurrently. |
| **D2** | **Cron schedule**: Keep `*/15` for both sweeps (current 12.2 decision) or tighten to `*/1` as 7.5 originally wanted? | 7.5 Task 6 coordination item: "ship at `*/15` and document the up-to-15-minute latency on both channels; tightening it is a joint change made by whichever story lands second." 16.4 lands second → **owner must confirm `*/15` is acceptable** or approve tightening + updating 12.2's 30-minute staleness threshold. |
| **D3** | **Push payload**: 7.5 `webPush.ts` sends **empty-payload** push (no RFC 8291 encryption). Is this acceptable for production, or must payload encryption be added? | 7.5 Dev Notes: "no RFC 8291 payload encryption — unverifiable in this environment." Empty payload means `notificationclick` opens app root, not deep link. In-app unread indicator handles the rest. |
| **D4** | **Email template**: 7.5 Task 5 specifies pointer-only email ("you have a new message on X"). Confirm no message body, no threading headers. | This is a privacy decision (7.5 Dev Notes § "Why the email says so little") — reaffirm or adjust. |

---

## Dependencies & Blockers

| Blocker | Status | Resolution |
|---------|--------|------------|
| **Epic 12 Gate G1** (Cloudflare secrets, `RESEND_API_KEY`, `RESEND_FROM`, VAPID keys) | **NOT DISCHARGED** | Ops action on project-owner account. 16.4 code can be built/tested without it (mocked HTTP), but **cannot deliver** until G1 is done. |
| **Story 12.2 coordination** | **LANDED** (`4446540`) | `workers/shared/resend.ts` exists and is the canonical transport. 16.4 consumes it. |
| **Migration safety for new Worker code** | **N/A** | No schema changes in 16.4 — only Worker TypeScript. |

---

## Testing Requirements

1. **Unit tests** (`sweepMessages.test.ts`):
   - Mock `sendEmail` → verify called with correct args per row
   - Mock `sendWebPush` → verify called per subscription, `410` triggers delete RPC
   - Verify `settle_message_notification` called with correct status/error
   - Verify aggregate counts returned

2. **Integration** (requires G1):
   - Deploy Workers, trigger `scheduled()` manually
   - Insert test `message_notifications` rows → verify email received, push received
   - Verify `cron_heartbeat` updated, `last_failed_count` accurate

3. **Typecheck/Lint/Prettier**: `make typecheck && npm run lint && make test` — must pass

---

## Definition of Done for 16.4

- [ ] `sweepMessages.ts` created, tested, wired into `index.ts`
- [ ] Channel enums unified to `DeliveryChannel` (S11), all call sites updated
- [ ] `make typecheck`, `npm run lint`, `make test` green
- [ ] No new migrations (schema unchanged)
- [ ] Owner decisions D1–D4 resolved and recorded
- [ ] Epic 7 marked complete in `epics.md` (16.4 closes it)

---

## Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| G1 not discharged before 16.4 code lands | High | Dead code in `main` | Build with mocked HTTP; gate real deploy on G1 |
| Channel enum refactor breaks 12.2 reminders | Medium | Regression in reminders create sheet | Coordinate with 12.2 owner; run full test suite |
| Empty-payload push fails on iOS/PWA edge cases | Medium | Push silently doesn't show | 7.5 already tested `public/push-sw.test.ts`; verify on real devices post-G1 |
| Backlog drain SQL run incorrectly | Low | Spam users with old notifications | Document exact one-liner; run once manually pre-G1 |

---

## Appendix: Ledger Item S11 Detail

From `epics.md` line 251: **"unifies the two channel enums in the same change (ledger item S11)"**

**Current state** (grep results):
```bash
# TaskDeliveryChannel usages:
src/components/atomic-crm/types.ts:102
src/components/atomic-crm/reminders/ReminderCreateSheet.tsx
src/components/atomic-crm/reminders/useReminders.ts (likely)
src/components/atomic-crm/providers/fakerest/internal/threads.ts (likely)

# MessageNotificationChannel usages:
src/components/atomic-crm/types.ts (7.5 addition)
src/components/atomic-crm/threads/usePushSubscription.ts
workers/cron/webPush.ts (likely)
```

**Action**: Single `DeliveryChannel` type in `types.ts`, all imports updated. This is a **cross-epic refactor** — 16.4 is the designated owner.