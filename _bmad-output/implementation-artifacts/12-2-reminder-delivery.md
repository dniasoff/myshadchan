# Story 12.2: Reminder delivery

Status: ready-for-dev *(code); delivery blocked on Epic 12 gate **G1**, now
**partially discharged (2026-08-02)** — the Cloudflare-auth/deploy half is done
(`deploy-workers` no longer skips; see Dependencies → D1), the Resend-domain half
(`RESEND_FROM` + a verified sending domain) is still open — see below.*

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Placement — SETTLED 2026-07-30 (reconciliation pass)

Renumbered from `12.1` to **Story 12.2** — two stories written in the same round both claimed
12.1. Epic 12 is **Phase-1 Completion & Operational Readiness**; the section *"The identifier —
Epic 12, story 12.1"* below is kept as history and is superseded by this block on the number only.
Its reasoning for *why a new epic* was accepted in full. Traceability tag unchanged: **(S5, AD-13)**.

**Binding delivery order inside Epic 12: 12.3 → 12.1 → 12.2 → 12.4.**

### Cross-story reconciliation findings (from the same pass)

- **F2 — BLOCKING contradiction with Story 12.3 (family-shared tasks). AC-5 must change once 12.3
  lands.** AC-5 currently requires a null `member_id` to settle **`failed`** with an error. Story
  12.3 introduces an explicit **Unassigned** option (its AC-3) and its migration *nulls* every
  unresolvable `member_id` (its AC-9). Landing both as written makes every deliberately-unassigned
  reminder a `failed` delivery row and drives AC-9's Settings heartbeat toward a permanent error
  state. **Ruling:** after 12.3, `member_id is null` settles **`skipped`** — a deliberate choice,
  not a failure. `failed` is reserved for a **non-null** `member_id` that names no live or no
  enabled member. Nothing is dropped without a record either way, so AC-5's intent survives intact.
- **F3 — BLOCKING product consequence, jointly with 12.3.** 12.3 rules that `member_id` is the
  *assignee* and that the creator is **not tracked**. This story emails `member_id`. Together: a
  parent who creates a reminder and assigns it to their spouse receives no notification at all, and
  nothing records who asked. The ruling is accepted, but AC-3's reworded delivery line in
  `ReminderCreateSheet.tsx` **must name the recipient** (e.g. *"Delivered in-app, and by email to
  the person it is assigned to. We never send SMS."*) — a line that is true today and still true
  after 12.3. Do not ship a second line that has to be corrected again.
- **F4 — BLOCKING wave conflict with Story 12.3.** Both edit `reminders/ReminderCreateSheet.tsx`
  (this story removes the push checkbox and rewords `:323-337`; 12.3 adds the assignee select to
  the same form), plus `types.ts`, both i18n catalogues, `supabase/schemas/01|02|06`,
  `registry.json`, `e2e/fixtures.ts`, and each adds its own `supabase/migrations/**` file. Neither
  author could see the other. **Never the same wave; 12.3 first.** This story's own dependency D5
  already anticipated it ("the enqueue step's recipient join is the single place that changes") —
  that is now a scheduled fact, not a contingency.
- **F8 — dependency D1 is now Epic 12 gate G1, shared with Story 12.4 (Stripe billing).** Both
  stories independently discovered that no Cloudflare Worker has ever deployed and both extend
  `.github/workflows/deploy.yml`'s secret-push steps. The prerequisite is discharged **once**, at
  the epic level; see `epics.md` → Epic 12 → gate G1. Do not obtain the Cloudflare credentials
  twice, and do not share a wave with 12.4 (`deploy.yml`).
- **F9 — `workers/shared/` conventions.** This story creates `workers/shared/resend.ts`; 12.4
  creates `workers/shared/cors.ts`; Story 7.5 (Epic 7, unbuilt) claims both. Whichever lands first
  sets the conventions for the directory; the later ones **extend, never fork**.
- **F12 — Story 12.1 (dashboard reminders card) is complementary, not duplicative.** 12.1 is the
  in-app glance; this story is AD-13's out-of-app floor. Neither supersedes the other and neither
  may be dropped as redundant. No surface overlap: AC-9's status row lands in Settings, not on the
  dashboard.

## Story

As a parent,
I want the reminders I set to actually reach me by email,
so that a follow-up I asked to be reminded about does not depend on me remembering to
open the app (FR44-46, AD-13).

## Why this story exists, and where it belongs

This is a **silent defect**: a feature the product tells the user is working, that has
never worked, and whose absence is invisible from inside the app.

The reminders hub, the polymorphic `tasks` shape, the create sheet and the
overdue/upcoming grouping are all built and deployed. What was never built is the half
that leaves the browser. `ReminderCreateSheet.tsx:324-328` renders, verbatim, to every
user today:

> *"Delivered in-app and by email. We never send SMS."*

Half of that sentence is false. Nothing in this repository has ever sent a reminder
email, and the surrounding checkbox (`:329-337`, *"Also send a push notification"*)
writes a `delivery_channels` value that no code has ever read.

### The identifier — Epic 12, story 12.1

This work sits outside Epics 1-11. It is not a feature from the mockup; it is the
completion of a Phase-1 feature that shipped with its delivery half missing, and it
belongs to none of the eleven planned epics:

- **Epic 7 (Communication) explicitly disowns it.** `7-5-notifications.md`'s scope note
  states that its "Epic 7" is the post-Amendment-A2 Communication epic, that reminders
  are "already-built Phase-1 functionality, not re-storied under the current
  `epics.md`", and that whatever delivery infrastructure it builds becoming available
  to reminders "is a beneficial side effect, not this story's job to guarantee". Its
  Task 4 says in terms: *"leave the reminders sweep as a TODO exactly as it is today —
  this story does not implement it."*
- It is already recorded as an unowned gap: **S5** in
  `_bmad-output/planning-artifacts/epics.md:1366-1368` — *"AD-13 reminder delivery is
  never wired … no story connects the reminders sweep to it, so reminders remain
  undelivered by any real channel."*

So: **Epic 12 — Silent Production Defects**, the bucket for adopted orphans from the
2026-07 mobile gap analysis that fix things believed shipped and silently absent.
`12-1` because it is the first. The epic owner may renumber when placing it; the
traceability that must survive renaming is the pair *(gap register S5, AD-13)*.

## Has it ever worked? No. Here is the evidence, in full

Four independent facts, each verified by reading the file:

1. **There is no delivery code.** `workers/cron/index.ts` is 18 lines. Its
   `scheduled()` handler (`:11-17`) is `console.warn("[cron] sweep tick")` and nothing
   else. Its own header comment (`:4-6`) admits it: *"only the health route and a
   logging stub exist for now."*
2. **Nothing anywhere reads `delivery_channels`.** The column is written by
   `ReminderCreateSheet.tsx:145-159` and declared in `types.ts:96-97,108` and
   `supabase/schemas/01_tables.sql:42,48-50`. Every other occurrence in the repository
   is a test asserting the *default value*, a FakeRest filter-adapter fixture, or the
   migration that added it. No consumer exists.
3. **No outbound email code exists at all.** `RESEND_API_KEY` is plumbed —
   `workers/cron/wrangler.toml:11-13` names it, `.github/workflows/deploy.yml:273-276`
   pushes it to the cron Worker and `:151-154` to Supabase Edge Functions — but no file
   in this repository calls Resend. The only `resend` matches in `src/` are the
   sign-in-code *"Resend code"* button, an unrelated feature.
4. **The Worker that would host the sweep has never been deployed.** *(True as of
   2026-07-30; see the 2026-08-02 update under Dependencies → D1 — the Worker now
   exists in production, health-check only, with the cron schedule still deliberately
   unregistered.)* The `deploy-workers` job (`.github/workflows/deploy.yml:222-288`) is
   gated on `IS_CLOUDFLARE_CONFIGURED = CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID`.
   Those secrets are absent, so every push takes the `:285-288` branch and writes
   *"Cloudflare Workers deployment skipped"* to the run summary. None of the seven
   Workers exists in production. Even the `crons = ["*/15 * * * *"]` trigger
   (`workers/cron/wrangler.toml:8-9`) has never been registered with Cloudflare.

**Verdict: reminder email delivery has never worked, in any environment, on any day of
this project.** The only channel that has ever functioned is `in_app`, and it functions
by accident: the Reminders hub lists every open task regardless of `delivery_channels`
(`reminders/useReminders.ts` filters on `done_date@is: null` only), so the `in_app`
value is never consulted either.

## What this story deliberately does not do

- **No push.** Push needs a `push_subscriptions` table, VAPID key handling, a Web Push
  sender and a client opt-in flow — all four are Story 7.5's Tasks 5 and 6. Building
  them here would fork that story. Instead this story **removes the dead push toggle**
  (AC-3) so the product stops offering a channel it cannot deliver, and
  `task_notifications.channel` is structurally constrained to `'email'` alone so no
  code path here can pretend otherwise.
- **No message notifications.** Epic 7's `message_notifications` fan-out is 7.5's.
  This story's queue is a different table for a different trigger condition (time-based
  "the reminder came due", not event-based "a message was inserted").
- **No dashboard reminders card, no assignee model, no shared family task list.** Those
  are gap items D1 and D3 and belong to other stories.
- **No `pg_cron`.** See Dev Notes → "Why the sweep stays on Cloudflare".

## Acceptance Criteria

Every criterion below states what failing looks like. Assertions in this repository have
shipped green over the property they claimed to assert; the `Fails if` clause is the
thing the test must actually be able to produce.

1. **A due reminder produces exactly one email, exactly once.** When a `tasks` row is
   open (`done_date is null`), has a non-null `due_date` at or before now, and carries
   `'email'` in `delivery_channels`, the next sweep tick emails the task's owner once
   and marks the delivery `sent`. Subsequent ticks send nothing further for that
   reminder at that due moment. Idempotency is **structural**, not procedural: a unique
   constraint on `task_notifications (task_id, channel, due_date)` plus `on conflict do
   nothing` in the enqueue step, so a second tick cannot create a second row to send.
   **Fails if:** running the sweep twice in a row against one due reminder produces two
   `sent` rows, or two calls to the Resend transport.

2. **Snoozing re-arms delivery.** `useReminders.ts`'s `snooze()` advances `due_date` by
   one day. Because the unique key includes `due_date`, the moved reminder enqueues a
   fresh row and is emailed again when it comes due at its new time.
   **Fails if:** a reminder that has already been emailed is snoozed, becomes due again,
   and the sweep sends nothing — which is what a `(task_id, channel)`-only unique key
   would produce.

3. **The product stops offering a channel it cannot deliver.** The push checkbox at
   `ReminderCreateSheet.tsx:329-337` and its `withPush` state are removed; the create
   sheet sends `delivery_channels: ['in_app', 'email']` unconditionally. The reassurance
   line at `:323-328` is reworded so no sentence it renders is false. The DB constraint
   `task_notifications_channel_check` admits `'email'` and nothing else — the same
   closed-enumeration style as `tasks_delivery_channels_check`
   (`01_tables.sql:48-50`), so a future "just add push here" cannot be a one-word edit
   that silently queues undeliverable rows.
   **Fails if:** a unit test creating a reminder through the sheet can produce a payload
   containing `"push"`, or an insert into `task_notifications` with `channel = 'push'`
   succeeds.

4. **The migration suppresses the pre-existing backlog, in the same migration.** At the
   moment this ships, production holds open reminders whose `due_date` is already in the
   past — including some overdue by weeks. Without a cutoff, the first sweep emails
   every one of them at once. The migration that creates `task_notifications` **also**
   inserts one `status = 'skipped'` row per (already-due, open, email-channel) task, so
   the enqueue step's `on conflict do nothing` suppresses them forever after.
   **Fails if:** immediately after `supabase migration up --local` against a database
   seeded with overdue reminders,
   `select count(*) from public.task_notifications where status <> 'skipped'` is
   non-zero, or a first sweep against that database attempts any send.
   `db diff` emits DDL and never data — this backfill is **hand-added** to the generated
   migration file, in the same file, and the story is not done if it lives in a second
   migration or a script. (This is the `member_state` lesson: a fail-closed mechanism
   that ships without backfilling the rows already in the table.)

5. **A reminder with no deliverable recipient fails loudly.** `tasks.member_id` is
   nullable (`01_tables.sql:37`) and points at `public.members`, not
   `account_members` (`:53-56`). When it is null, names no live member, or names a
   member with `disabled = true`, the enqueue step still writes a row — with
   `status = 'failed'` and an explanatory `error` — rather than skipping the task
   silently.
   **Fails if:** a due reminder whose `member_id` is null leaves `task_notifications`
   empty. Nothing may be dropped without a record; `.claude/rules/coding-style.md`
   forbids silently swallowing errors and this is the case that would otherwise be
   invisible for exactly the same reason the whole feature was.

6. **Two overlapping ticks cannot double-send.** The claim step sets
   `status = 'pending' → 'sending'` in the same statement that selects the rows, using
   `for update skip locked`, inside a `service_role`-only SECURITY DEFINER function
   (PostgREST cannot express `for update skip locked`).
   **Fails if:** two concurrent `claim_due_task_notifications()` calls against the same
   pending set both return the same row id. The DB suite must assert this with two real
   sessions, not by inspecting the function body.

7. **The Worker never touches a tenant table directly.** AD-7 states that *"the only way
   a Worker touches a tenant table is a mandatory `forAccount(accountId)` scoped
   client"* and that un-scoped access must be unrepresentable. The reminders sweep is
   inherently cross-tenant, so it satisfies AD-7 by issuing **no table query at all**:
   every read and write goes through three `service_role`-only RPCs
   (`claim_due_task_notifications`, `settle_task_notification`,
   `record_cron_heartbeat`), and the cross-tenant read lives inside Postgres where the
   definer boundary is. This story does **not** claim the "cron-Worker exemption"
   Story 7.5's Task 4 asserts; AD-7's text grants no such exemption.
   **Fails if:** `workers/cron/**` contains any `.from("tasks")`, `.from("members")` or
   any other `.from(<tenant table>)` call. Assert it as a `?raw` source scan in the
   worker test, in the style of `3-11`'s conformance scans — a reviewer's eye is not
   the control.

8. **`task_notifications` is unreachable from a browser; `cron_heartbeat` leaks
   nothing.** `task_notifications` gets RLS enabled and **no policy for `authenticated`
   at all** — the stricter form of the `subscription` / `ai_usage` posture
   (`05_policies.sql:526-543`, `06_grants.sql:698-712`), which withholds even SELECT
   because a client has no legitimate reason to read a delivery queue that carries
   recipient email addresses across every tenant. `cron_heartbeat` is readable by any
   authenticated user (`using (true)`) because it holds no tenant data — but for that to
   be true, `cron_heartbeat.last_error` must be a **bounded code** from a closed set
   (`'rpc_failed' | 'transport_failed' | 'unknown'`), never a raw provider response
   body, stack trace or URL.
   **Fails if:** an authenticated PostgREST client reads one or more rows from
   `task_notifications`; or any code path can write a free-text string into
   `cron_heartbeat.last_error`. Both are mandatory negative tests
   (`.claude/rules/security-triggers.md` applies — this story adds RLS-guarded tables, a
   migration and new grants).

9. **"Not running" is visible instead of silent.** Every tick, success or failure, the
   Worker upserts `public.cron_heartbeat` for `worker = 'cron'`. A single row under
   Settings → Preferences (`PreferencesSection.tsx`, rendered by both
   `SettingsPage.tsx:64` and `SettingsPageMobile.tsx:60`, so one component reaches both
   surfaces) reports one of exactly three states, i18n'd into both catalogues:
   - **no row for `'cron'`** → *"Not set up yet"* — the true state of production today,
     and of every local and demo build;
   - **`last_ok_at` within 30 minutes** (2× the cron period) → *"Sending"*;
   - **otherwise** → *"Paused"*.

   **Fails if:** with the heartbeat table empty the row renders "Sending", or renders
   nothing at all. This AC is the anti-recurrence control: the reason this defect
   survived to production is that a dead sweep and a healthy sweep are
   indistinguishable from inside the app.

10. **Deployment is part of done, not a follow-up.** Because the Cloudflare Workers have
    never been deployed, code merged to `main` changes nothing in production. This story
    is delivered only when a real reminder email arrives at a real inbox from the
    deployed `myshadchan-cron` Worker. The blocking prerequisites are listed under
    **Dependencies** and are secrets/ops actions, not code.
    **Fails if:** the story is closed with `deploy-workers` still printing *"Cloudflare
    Workers deployment skipped"*, or with `cron_heartbeat` empty in the hosted database
    after a full cron period.

11. **Verification — the toolchain is green**, plus the new
    `supabase/tests/reminder_delivery.sql` suite covering AC-1, 2, 4, 5, 6 and both
    negative tests of AC-8, and the new Worker unit tests covering AC-1's
    claim→send→settle ordering, AC-7's source scan and the failure path that records
    `status = 'failed'` with the transport error preserved on the row (not on the
    heartbeat). `make typecheck && npm run lint && make test && npm run test:unit:db`,
    plus prettier on this story's changed files only.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: the delivery queue and the heartbeat** (AC: 1, 2, 3, 5, 8)
  - [ ] `supabase/schemas/01_tables.sql`, immediately after the `tasks` block
        (`:27-51`) so the two read together: add
        `public.task_notifications(id bigint generated by default as identity primary
        key, account_id bigint not null, task_id bigint not null, channel text not null,
        due_date timestamptz not null, status text not null default 'pending',
        recipient_email text, attempts integer not null default 0, sent_at timestamptz,
        error text, created_at timestamptz not null default now())`.
        - `constraint task_notifications_channel_check check (channel in ('email'))`
          — AC-3's structural exclusion of push.
        - `constraint task_notifications_status_check check (status in ('pending',
          'sending', 'sent', 'failed', 'skipped'))` — `sending` exists for AC-6's
          claim-before-dispatch; `skipped` for AC-4's backfill.
        - `constraint task_notifications_task_id_channel_due_date_key unique (task_id,
          channel, due_date)` — AC-1 and AC-2 both rest on this key. Do not reduce it to
          `(task_id, channel)`.
        - FKs (in the `alter table` block at the foot of the file, beside the existing
          `tasks_account_id_fkey` constraint — grep for it by name, not by line: Epic 5
          is editing this file concurrently and its line numbers move):
          `account_id → public.accounts(id) on delete cascade`,
          `task_id → public.tasks(id) on delete cascade`.
        - Index `task_notifications_pending_idx (status, created_at)` — the claim query
          filters `status = 'pending'` ordered by `created_at`.
  - [ ] Add `public.cron_heartbeat(worker text primary key, last_run_at timestamptz not
        null default now(), last_ok_at timestamptz, last_error text)`. No `account_id`:
        it is a system-status table, deliberately outside the tenant model, which is
        what makes AC-8's `using (true)` read policy defensible.
  - [ ] **Do not** touch `tasks_delivery_channels_check` (`:48-50`). It keeps `'push'`
        as a legal value so Story 7.5 can adopt it later without a data migration; this
        story simply never emits it from the client and never enqueues it.

- [ ] **Task 2 — Functions: enqueue, claim, settle, heartbeat** (AC: 1, 2, 5, 6, 7, 8)
  - [ ] `supabase/schemas/02_functions.sql` — all four `SECURITY DEFINER SET search_path
        ''`, following the style of `set_account_id_default()` (`:396-407`):
  - [ ] `public.enqueue_due_task_notifications(p_now timestamptz default now()) returns
        integer` — inserts one `channel = 'email'` row per open, due, email-channel task
        (`t.done_date is null and t.due_date is not null and t.due_date <= p_now and
        'email' = any (t.delivery_channels)`), `left join public.members m on m.id =
        t.member_id and m.disabled = false`, with
        `status = case when m.email is null then 'failed' else 'pending' end`,
        `recipient_email = m.email::text`, and an explanatory `error` on the failed
        branch (AC-5). Terminates with
        `on conflict (task_id, channel, due_date) do nothing` (AC-1/AC-4). Returns the
        inserted row count.
  - [ ] `public.claim_due_task_notifications(p_limit integer) returns table(id bigint,
        task_id bigint, account_id bigint, recipient_email text, task_text text,
        due_date timestamptz, target_type text, target_id bigint)` — calls
        `perform public.enqueue_due_task_notifications();` first, then the
        claim-then-return CTE in Dev Notes (`for update skip locked`, `status →
        'sending'`, `attempts + 1`), joined to `public.tasks` for the text and target so
        the Worker needs no second call.
  - [ ] `public.settle_task_notification(p_id bigint, p_status text, p_error text
        default null) returns void` — rejects any `p_status` outside `('sent',
        'failed')` with `raise exception`; updates only rows currently in `'sending'`
        (so a late duplicate settle cannot resurrect a finished row); sets `sent_at =
        now()` on `'sent'`.
  - [ ] `public.record_cron_heartbeat(p_worker text, p_error text default null) returns
        void` — upsert on `worker`; `last_run_at = now()` always, `last_ok_at = now()`
        only when `p_error is null`. Reject any `p_error` outside
        `('rpc_failed', 'transport_failed', 'unknown')` with `raise exception` — AC-8's
        bounded-code requirement enforced in the database, not by the caller's good
        intentions.

- [ ] **Task 3 — RLS, grants** (AC: 8)
  - [ ] `supabase/schemas/05_policies.sql`: `alter table public.task_notifications
        enable row level security;` and **no policy for `authenticated`** — add the
        comment explaining why, in the shape of the `subscription`/`ai_usage` block at
        `:526-533`. `alter table public.cron_heartbeat enable row level security;` plus
        `create policy "Cron heartbeat readable by any signed-in member" on
        public.cron_heartbeat for select to authenticated using (true);` with the
        "holds no tenant data, `last_error` is a bounded code" justification inline.
        (`force row level security` is not used anywhere in this schema — do not
        introduce it here.)
  - [ ] `supabase/schemas/06_grants.sql`, in the hardening block beside `tasks`
        (`:629-630`): `revoke all on table public.task_notifications from anon,
        authenticated; grant all on table public.task_notifications to service_role;`
        and the same revoke on `public.task_notifications_id_seq` with
        `grant all … to service_role`. `revoke all on table public.cron_heartbeat from
        anon, authenticated; grant select on table public.cron_heartbeat to
        authenticated; grant all on table public.cron_heartbeat to service_role;`
  - [ ] Function grants: for all four new functions,
        `revoke all on function … from public, anon, authenticated;` then
        `grant execute on function … to service_role;`. None of the four is ever called
        from a browser.

- [ ] **Task 3a — Generate the migration, then hand-add the backfill** (AC: 4, 8)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        reminder_delivery`.
  - [ ] Hand-check the generated file before applying: confirm the composite unique key
        `(task_id, channel, due_date)` is present (a multi-column key is exactly what
        `db diff` has under-emitted before), and confirm both `enable row level
        security` statements survived.
  - [ ] **Hand-add** the AC-4 backfill to the *same* migration file, after the
        `create table` and before the policies:
        ```sql
        insert into public.task_notifications
          (account_id, task_id, channel, due_date, status, error)
        select t.account_id, t.id, 'email', t.due_date, 'skipped',
               'pre-delivery backlog suppressed by the migration that introduced this table'
        from public.tasks t
        where t.done_date is null
          and t.due_date is not null
          and t.due_date <= now()
          and 'email' = any (t.delivery_channels)
        on conflict do nothing;
        ```
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset`, never `db push`.

- [ ] **Task 4 — The Resend transport** (AC: 1, 11)
  - [ ] New `workers/shared/resend.ts`: `sendEmail({ from, to, subject, text })` around
        `POST https://api.resend.com/emails`, returning a discriminated result
        (`{ ok: true, id } | { ok: false, error }`) rather than throwing, so the sweep
        can settle a row `failed` with the reason instead of losing the batch. Secrets
        never reach the client bundle (spine "Security (Workers)" row).
  - [ ] **Coordination with Story 7.5:** 7.5's Task 4 declares the *same* file
        `workers/shared/resend.ts` for the same reason. Whichever of the two lands first
        creates it; the second consumes it unchanged and adds no second wrapper. They
        must not be scheduled in the same wave. If 7.5 has already landed, this task
        reduces to asserting the signature above still holds and adding the reminder
        subject/body.

- [ ] **Task 5 — The sweep** (AC: 1, 5, 6, 7, 9)
  - [ ] New `workers/cron/sweepReminders.ts`, exporting
        `sweepReminders(env: CronEnv): Promise<{ claimed: number; sent: number; failed:
        number }>`. Creates a `service_role` `@supabase/supabase-js` client (the client
        the Workers already use — there is no `pg` driver in this repo), calls
        `.rpc("claim_due_task_notifications", { p_limit: 100 })`, and for each row sends
        one email and calls `.rpc("settle_task_notification", …)`. **No `.from(...)`
        call anywhere in the file** (AC-7).
  - [ ] Subject/body: one plain-text email naming the reminder text and what it is
        about. It links to `<APP_ORIGIN>/#/reminders` — the app runs on ra-core's
        default `HashRouter` (`RemindersPage.path = "/reminders"`), so the `#` is
        load-bearing, not decoration. `APP_ORIGIN` is a new plain (non-secret) `[vars]`
        entry in `workers/cron/wrangler.toml`.
  - [ ] `workers/cron/index.ts`: declare
        `interface CronEnv extends BaseEnv { RESEND_API_KEY: string; RESEND_FROM:
        string; APP_ORIGIN: string }` locally (the per-Worker extension pattern
        `workers/shared/env.ts` documents; do not widen `BaseEnv`). Replace the
        `console.warn` stub with `try { await sweepReminders(env); await
        recordHeartbeat(env, null) } catch { await recordHeartbeat(env, code); throw }`,
        and update the file's `:4-6` comment, which currently claims push is delivered
        here.
  - [ ] `workers/cron/wrangler.toml`: keep `crons = ["*/15 * * * *"]` but rewrite the
        `:6-7` comment from "provisional … tune once the reminders epic defines real
        delivery windows" to the decision this story makes — 15 minutes is the reminder
        delivery window, and 30 minutes (2×) is the heartbeat staleness threshold AC-9
        renders. Add `RESEND_FROM` and `APP_ORIGIN` to the `:11-13` secrets/vars
        comment. Note that Story 7.5 tightens this schedule to `*/1` for message
        notifications; if it lands, reminders simply sweep more often — harmless, and
        the 30-minute staleness threshold still holds.
  - [ ] `.github/workflows/deploy.yml`: extend the cron-secrets step (`:273-276`) to
        push `RESEND_FROM` as well, and add both to the job `env` block (`:239-245`).

- [ ] **Task 6 — Stop promising push; tell the truth about delivery** (AC: 3, 9)
  - [ ] `reminders/ReminderCreateSheet.tsx`: delete the `withPush` state (`:106`), its
        reset inside `resetForm()` (`:139`), the conditional at `:145-147` (send
        `BASE_DELIVERY_CHANNELS` directly), and the checkbox at `:329-337`. Reword
        `crm.reminders.create.deliveryNote` (`:324-328`) so nothing it says is untrue —
        it may still state that SMS is never sent, which is and remains correct. Drop
        the now-unused `Checkbox` import if it has no other use in the file.
  - [ ] New `reminders/ReminderDeliveryStatus.tsx` (its own file — keep
        `PreferencesSection.tsx` small per `.claude/rules/coding-style.md`): reads
        `useGetOne("cron_heartbeat", { id: "cron" })` and renders AC-9's three states.
        It must treat "no row" and "error fetching" distinctly from "stale": a failed
        fetch is not evidence that the sweep is healthy.
  - [ ] `settings/PreferencesSection.tsx`: mount it as a third `Item` row after
        `ThemeRow`, inside the existing `ItemGroup` with an `ItemSeparator` — one edit
        that reaches both `SettingsPage.tsx:64` and `SettingsPageMobile.tsx:60`.
  - [ ] i18n: add the three state strings plus the row label under the existing
        `crm.reminders` block in **both** catalogues —
        `providers/commons/englishCrmMessages.ts:709-716` and
        `providers/commons/frenchCrmMessages.ts:645-652`. Both, not one.

- [ ] **Task 7 — Types and providers** (AC: 3, 9)
  - [ ] `types.ts`: add `TaskNotificationStatus = "pending" | "sending" | "sent" |
        "failed" | "skipped"`, `TaskNotification`, and `CronHeartbeat`. Leave
        `TaskDeliveryChannel` (`:96-97`) exactly as it is — it mirrors the DB check
        constraint, which this story does not narrow, and 7.5 documents at length why
        the two channel enums must not be unified as a side effect of an unrelated
        story.
  - [ ] `root/routeManifest.ts`: **no change.** `cron_heartbeat` is read by a hook, not
        registered as a react-admin `<Resource>`; it has no list, show or edit surface.
  - [ ] FakeRest: add a `cron_heartbeat` collection to
        `providers/fakerest/dataGenerator/index.ts` seeded with a fresh row (so the demo
        build renders "Sending" rather than a permanently alarming "Not set up yet"),
        and confirm `providers/fakerest/dataProvider.ts` needs no special-casing — it is
        a plain single-row read. Document in the generator that email delivery itself is
        inherently unexercisable in the FakeRest build: there is no backend to run a
        sweep against. That is expected, not a gap.

- [ ] **Task 8 — Tests** (AC: 11, and the negative tests of AC-8)
  - [ ] New `supabase/tests/reminder_delivery.sql` + `reminder_delivery.test.ts`,
        following `supabase/tests/tasks_target_types.{sql,test.ts}` exactly: a temp
        `results` table, one row per named check, a JSON report on the last line, the
        whole thing inside `begin; … rollback;`, and the runner's
        `bailIfDbUnreachable()` skip. Checks:
        - enqueue creates exactly one row for a due email-channel reminder; a second
          enqueue creates none (AC-1);
        - a task snoozed to a new `due_date` enqueues a second row (AC-2);
        - a due reminder with `member_id` null enqueues a `failed` row with a non-null
          `error`, never zero rows (AC-5);
        - two sessions calling `claim_due_task_notifications(10)` concurrently return
          disjoint id sets (AC-6) — two real sessions, not one;
        - `insert … channel = 'push'` is rejected by the check constraint (AC-3);
        - `settle_task_notification(id, 'bogus')` raises;
        - `record_cron_heartbeat('cron', 'some raw provider text')` raises (AC-8);
        - **negative:** an authenticated session (`set local role authenticated` +
          `set local request.jwt.claims`, the pattern
          `context_rls_hardening.sql` establishes) selects **zero** rows from
          `task_notifications`, including rows in its own account (AC-8);
        - **negative:** the same session's `insert`/`update`/`delete` on
          `task_notifications` and on `cron_heartbeat` all affect zero rows;
        - the AC-4 backfill: with two overdue open reminders present before the table
          exists, after the migration every `task_notifications` row is `'skipped'`.
          (Exercise this by re-running the backfill statement against a seeded fixture
          inside the suite — asserting the statement's semantics, not re-running the
          migration.)
  - [ ] New `workers/cron/sweepReminders.test.ts` and
        `workers/shared/resend.test.ts` (Node project, `npm run test:unit:workers`;
        Hono/`app.request()` conventions per `workers/cron/index.test.ts`): mock the
        supabase client and `fetch`; assert claim → send → settle ordering, that a
        transport failure settles `failed` with the reason on the row, that the batch
        continues past one failure, and AC-7's `?raw` scan that `workers/cron/**`
        contains no `.from(` call.
  - [ ] `workers/cron/index.test.ts`: replace the `console.warn` assertion (`:25-34`) —
        it is currently the only test of `scheduled()` and it asserts the stub. New
        assertions: `scheduled()` calls the sweep, records a heartbeat with no error on
        success, and records `'rpc_failed'`/`'transport_failed'` and rethrows on
        failure.
  - [ ] `reminders/ReminderCreateSheet.test.tsx` (new, or extend if one exists by then):
        the created payload's `delivery_channels` is exactly `['in_app', 'email']` and
        the push checkbox is absent from the DOM (AC-3).
  - [ ] `reminders/ReminderDeliveryStatus.test.tsx`: the three AC-9 states, driven by
        three different `cron_heartbeat` fixtures, plus the fetch-error case.
  - [ ] `e2e/reminder-delivery-status.spec.ts` (`e2e-conventions` — this story changes
        Settings UI and a form): seed `cron_heartbeat` through the service-role client
        in `e2e/fixtures.ts`, sign in, open Settings, assert the rendered state for a
        fresh row and for a stale one. Add `cron_heartbeat` to `fixtures.ts`'s
        reset list — it has no `account_id`, so deleting `accounts` does not cascade it
        away and it would leak between specs.
  - [ ] `registry.json` is regenerated by the pre-commit hook once
        `ReminderDeliveryStatus.tsx` exists; commit the regenerated file.

## Dev Notes

### The claim-then-dispatch pattern (AC-6)

```sql
with claimed as (
  update public.task_notifications tn
  set status = 'sending', attempts = tn.attempts + 1
  where tn.id in (
    select id from public.task_notifications
    where status = 'pending'
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning tn.*
)
select c.id, c.task_id, c.account_id, c.recipient_email,
       t.text, c.due_date, t.target_type, t.target_id
from claimed c
join public.tasks t on t.id = c.task_id;
```

`for update skip locked` is what makes an overlapping tick safe: a slow run still
holding rows is skipped rather than double-claimed. It ships as a function because
PostgREST cannot express it, and its execute grant is `service_role` only. This is the
same pattern Story 7.5 documents for `message_notifications`; the two queues are
deliberately separate tables because their trigger conditions differ (time-based here,
insert-triggered there), but the claim mechanics should read identically so a reviewer
who has read one recognises the other.

### Why the unique key includes `due_date`

`(task_id, channel)` alone would be simpler and wrong. `useReminders.ts`'s `snooze()`
moves `due_date` forward a day; the whole point of a snooze is to be reminded again.
With `due_date` in the key, one email is sent per (reminder, channel, due moment) —
snooze re-arms, a repeated tick does not. It also makes AC-4's backfill trivially
correct: the suppressed rows carry the *current* `due_date`, so a snoozed backlog item
correctly becomes deliverable at its new time.

### Why the sweep stays on Cloudflare, despite the deployment blocker

The obvious shortcut is `pg_cron` + `pg_net` inside Supabase, which would dodge the
never-deployed-Workers problem entirely: `RESEND_API_KEY` is *already* pushed to Supabase
Edge Functions (`.github/workflows/deploy.yml:151-154`), and the Supabase pipeline
demonstrably works — Epics 1-4 are live. It is rejected here because AD-7 names
Cloudflare Workers as the compute home for cron specifically, and moving cron to the
data plane is an architecture decision for the spine owner, not a side effect of a
defect fix. Recorded, not taken. If the Cloudflare secrets prove genuinely unobtainable,
escalate to the architecture owner rather than quietly building the Supabase version —
`pg_cron` is not currently enabled in `supabase/config.toml`, so that route is also not
free.

The consequence is that **Dependency D1 below is a hard blocker on delivery, not a
deployment detail.** Merging this story with the Cloudflare secrets still absent
reproduces the exact failure it exists to fix: correct code, green tests, nothing
delivered, and no signal that nothing was delivered — except that AC-9 now makes that
last part visible, which is the one thing that improves even if D1 stalls.

### AD-13 names columns that do not exist

`ARCHITECTURE-SPINE.md#AD-13` writes the shape as
`tasks(account_id, due_at, target_type ∈ {shadchan,suggestion,reference}, target_id,
delivery_channels, done_at)`. The shipped table is `due_date` / `done_date`, and
`target_type` is `('shadchan', 'shidduch', 'reference', 'single')`
(`01_tables.sql:35-36,45-47`). Write against the table, not the spine prose. The spine's
*rule* — email is the guaranteed non-smartphone floor, no outbound SMS — is what binds,
and this story implements exactly that floor.

### `tasks.member_id` is `public.members`, not `account_members`

`01_tables.sql:53-56` flags this collision explicitly, and it matters here: the
recipient's email address is `public.members.email` (`:14-23`, an `extensions.citext`
column that is `not null`), reachable with a plain join. This story therefore needs none
of the `auth.users` / `client.auth.admin.getUserById()` machinery Story 7.5 requires,
because 7.5's recipient is an `account_members` row which carries no email. Do not copy
7.5's recipient-resolution code.

It also means the recipient is the task's **owner** — the member who created it, via
`set_member_id_default()` (`02_functions.sql:168-178`). This story does not change that.
Whether both parents in a household should receive a reminder is gap item **D3**
(family-shared tasks with assignees), a separate story with a data-model decision to
make; delivering to the existing owner is the correct scope here and must not be quietly
widened to "every member of the account".

### The `in_app` channel is decorative, and stays that way

The Reminders hub lists open tasks regardless of `delivery_channels`
(`useReminders.ts`, filter `{"done_date@is": null}`), so `'in_app'` is never read. That
is fine and matches 7.5's reasoning about in-app delivery being a derived read state
rather than a queued artefact. This story does not remove the value and does not enqueue
for it; `task_notifications` covers `'email'` only.

### Testing standard

Per `.claude/rules/testing.md`: AAA, descriptive names, ≥80% coverage on new code paths.
**The frontend stack is `vitest-browser-react` running in real Chromium with ra-core's
`TestMemoryRouter` — React Testing Library is not a dependency of this repository.**
Component tests mount inside `<CoreAdminContext>` / `<TestMemoryRouter>`; mounting a
bare component without the contexts it needs throws, React Router swallows the throw,
and the test ships green over nothing — the failure mode `5-1`'s testing note records.
Worker tests run in the Node `workers` project (`npm run test:unit:workers`); DB tests
run through psql via `npm run test:unit:db` and skip themselves when the stack is down.

### Declared file set (for the wave planner)

Every declared file set in this project has so far been too small. This one names the
categories that keep getting missed.

**New:**
- `supabase/migrations/<ts>_reminder_delivery.sql` (generated, then hand-edited — Task 3a)
- `supabase/tests/reminder_delivery.sql`, `supabase/tests/reminder_delivery.test.ts`
- `workers/shared/resend.ts`, `workers/shared/resend.test.ts` *(shared ownership with
  Story 7.5 — see Task 4)*
- `workers/cron/sweepReminders.ts`, `workers/cron/sweepReminders.test.ts`
- `src/components/atomic-crm/reminders/ReminderDeliveryStatus.tsx`,
  `ReminderDeliveryStatus.test.tsx`
- `src/components/atomic-crm/reminders/ReminderCreateSheet.test.tsx` *(if absent)*
- `e2e/reminder-delivery-status.spec.ts`

**Modified:**
- `supabase/schemas/01_tables.sql`, `02_functions.sql`, `05_policies.sql`,
  `06_grants.sql`
- `workers/cron/index.ts`, `workers/cron/index.test.ts`, `workers/cron/wrangler.toml`
- `.github/workflows/deploy.yml`
- `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx`
- `src/components/atomic-crm/settings/PreferencesSection.tsx`
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`
- `e2e/fixtures.ts` (reset list)
- `registry.json` (regenerated by the pre-commit hook)

**Explicitly NOT modified** (named so the planner does not reserve them):
`root/routeManifest.ts` (no new resource or route), `entity360/entityDescriptor.ts` and
every `<entity>/entityDescriptor.ts` (no new entity), `<entity>/index.ts`,
`providers/supabase/dataProvider.ts` (`cron_heartbeat` is a plain `getOne`; the three
RPCs are Worker-only and never reachable from the browser), `scripts/retired-names.json`
(no fossil vocabulary introduced), and `_bmad-output/planning-artifacts/epics.md` — S5's
close-out is the epic owner's edit, not this story's.

**Contested with Story 7.5** (must not share a wave): `workers/shared/resend.ts` (+ test),
`workers/cron/index.ts` (+ test), `workers/cron/wrangler.toml`, `types.ts`,
`supabase/schemas/*.sql`, `supabase/migrations/**`.

### Project Structure Notes

- Three files in `workers/`, none over the 200-400 line typical ceiling — the transport,
  the sweep and the entry point stay separate rather than growing `index.ts`
  (`.claude/rules/coding-style.md`, "grow the file count").
- No new top-level `src/` directory. `ReminderDeliveryStatus.tsx` lives in the existing
  `reminders/` folder even though it is mounted from `settings/`, because it is a
  reminders concern rendered elsewhere, and `settings/` already imports across folders
  (`SettingsPageMobile.tsx` imports `../billing/BillingPage`).
- `task_notifications` and `cron_heartbeat` are backend tables, not react-admin
  resources. Only `cron_heartbeat` is read from the client, and only as a single
  `getOne`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:1366-1368] — gap **S5**, *"AD-13
  reminder delivery is never wired"*, the unowned finding this story closes.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-13]
  — the polymorphic reminders shape, the cron Worker as its home, and "email is the
  guaranteed non-smartphone floor, via Resend; no outbound SMS".
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-7]
  — Workers as compute home, and the `forAccount()` rule AC-7 satisfies by making no
  table call at all.
- [Source: _bmad-output/implementation-artifacts/7-5-notifications.md] — the scope note
  disowning reminders delivery, the claim-then-dispatch pattern, the shared
  `workers/shared/resend.ts` file, and the "do not unify `TaskDeliveryChannel`"
  instruction this story honours.
- `workers/cron/index.ts:4-6,11-17` — the header comment claiming delivery happens here,
  and the `console.warn` stub that is all that does.
- `workers/cron/wrangler.toml:6-9,11-13` — the provisional `*/15` trigger and the
  `RESEND_API_KEY` secrets comment.
- `.github/workflows/deploy.yml:222-288` — the `deploy-workers` matrix job, its
  `IS_CLOUDFLARE_CONFIGURED` gate, the cron secrets step (`:273-276`) and the
  "deployment skipped" branch (`:285-288`) that has taken every push to date.
- `supabase/schemas/01_tables.sql:14-23,27-58` — `members` (with its `email` column),
  the `tasks` table, and the `member_id`-referent note plus its `comment on column`.
  The FK block lives at the foot of the same file (`tasks_account_id_fkey`) — locate it
  by constraint name; Epic 5 is editing this file concurrently and every line number
  below the `tasks` block moves under it.
- `supabase/schemas/02_functions.sql:168-178,396-407` — `set_member_id_default()` and
  `set_account_id_default()`, the definer style Task 2 follows.
- `supabase/schemas/05_policies.sql:31-38,526-543` — the `tasks` account policy, and the
  `subscription`/`ai_usage` no-write-policy precedent `task_notifications` follows more
  strictly still.
- `supabase/schemas/06_grants.sql:629-630,698-712` — the `tasks` hardening lines and the
  billing-table grant shape Task 3 mirrors.
- `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx:53,106,145-159,323-337` —
  the base channels, the `withPush` state, the payload, and the false reassurance line +
  dead toggle that Task 6 removes.
- `src/components/atomic-crm/reminders/useReminders.ts` — `snooze()` (the `due_date`
  advance AC-2 depends on) and the `{"done_date@is": null}` list filter that makes the
  `in_app` channel decorative.
- `src/components/atomic-crm/settings/PreferencesSection.tsx:25-38` and
  `SettingsPage.tsx:64` / `SettingsPageMobile.tsx:60` — the single mount point that
  reaches both surfaces.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts:709-716`,
  `frenchCrmMessages.ts:645-652` — the existing `crm.reminders` blocks the new keys join.
- `supabase/tests/tasks_target_types.sql` + `.test.ts` — the DB-suite harness Task 8
  copies (temp `results` table, JSON report, `bailIfDbUnreachable`).
- `.claude/rules/security-triggers.md` — RLS, migrations and grants are all touched here;
  a security review is mandatory, not discretionary.

## Dependencies

- **D1 — BLOCKING, and not a code task.** The Cloudflare Workers have never been
  deployed. Before this story can be *delivered* (as opposed to merged), the following
  must exist as GitHub repository secrets: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` (which together un-gate the whole `deploy-workers` job),
  `RESEND_API_KEY`, and `RESEND_FROM` — plus a **verified sending domain** in the Resend
  account, without which every send returns a 403 and every row settles `failed`.
  Whoever schedules this story owns obtaining them. See Dev Notes → "Why the sweep stays
  on Cloudflare".

  **D1 / gate G1 status — UPDATE 2026-08-02, partially discharged.** The narrow trigger
  named in `epics.md`'s gate G1 — *`deploy-workers` stops printing "Cloudflare Workers
  deployment skipped"* — is now **satisfied**. Root causes fixed, in order: (1) the
  `CLOUDFLARE_API_TOKEN` secret had been a Global API Key, which `wrangler` sends as a
  Bearer token and Cloudflare rejects (`9109`) — replaced with a scoped token
  (`myshadchan-gha-deploy-2026-08-02`, Workers Scripts Write + R2 Write, this account
  only); (2) the account had no `workers.dev` subdomain registered, so nothing could
  publish — `myshadchan.workers.dev` is now registered. First-ever green
  `deploy-workers` run: **30743735202** (re-run of the `main` push that already carried
  the code fixes), all five gated-in legs (`ingest`, `parse`, `match`, `ai`, `cron`)
  uploaded and live at `https://myshadchan-<worker>.myshadchan.workers.dev/health`,
  each answering only `{"success":true,"data":{"worker":"<name>","status":"ok"}}` with
  the required security headers, no env/version/stack-trace leak. `cron` deployed
  **without** its schedule — `[triggers]` stayed commented out in
  `workers/cron/wrangler.toml` exactly as designed, confirmed both in the deploy log
  ("Deployed myshadchan-cron triggers" refers to route/binding registration, not a cron
  schedule — none is declared) and by re-reading the file post-deploy. **This story
  still owns re-enabling that trigger, together with its own AC-4 overdue-backlog
  backfill** — this deploy changes nothing about that ownership.

  **Still open, and this story is not yet clear to *deliver* on that basis alone:**
  `RESEND_FROM` is absent from the repository's GitHub Actions secrets (checked
  2026-08-02 via `gh api repos/.../actions/secrets`; only `RESEND_API_KEY` is present,
  as it already was), no Resend sending domain has been confirmed verified, no Worker
  has a pinned per-Worker URL (all five are on the `workers.dev` default epics.md's G1
  text calls out as the thing to move off of, not a final state) or a declared route,
  and none has CORS configured. None of this is code this story is missing — it is the
  remainder of D1/G1 — but it means "the Workers deploy" and "this story can deliver
  email" are now two different open questions, not one.
- **D2 — Story 7.5 (Epic 7) shares `workers/shared/resend.ts`, `workers/cron/index.ts`,
  `workers/cron/wrangler.toml` and `types.ts`.** Either order works; the same wave does
  not. Task 4 states the hand-off in both directions.
- **D3 — no dependency on Epics 5, 6, 8-11.** This story touches no 360 shell, no entity
  descriptor, no list surface. It is schedulable against the currently-deployed
  production codebase (`a8c5e3d`) as-is, and is not blocked by Epic 5's in-flight work.
- **D4 — assumes the deployed Epic 1-4 world:** `singles`/`single_id`, `members`,
  `current_context_id()` (AD-19), the four-value `tasks_target_type_check`. All present
  in `supabase/schemas/` today.
- **D5 — gap item D3 (family-shared tasks with assignees) is a successor, not a
  prerequisite.** If it lands later and changes who owns a task, the enqueue step's
  recipient join is the single place that changes.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5, dispatched as two sequential agents (database/Worker, then SPA) under an
opus-5 orchestrator, followed by four parallel review lenses, per-finding adversarial
verification, a fix pass and a gate pass.

### Debug Log References

- **AC-2 unique-key guard, shown red before green.** Reverted the queue's unique key to
  `(task_id, channel)` on the live stack: the whole `reminder_delivery.sql` suite went red with
  `ON CONFLICT` failing outright (no matching constraint), proving `due_date` must be in the key.
  Restored and re-verified green.
- **AC-5 skipped/failed split, shown red before green.** Reverted
  `enqueue_due_task_notifications()` to the pre-12.3 "null -> failed" behaviour: exactly and only
  the AC-5 test went red. Restored and re-verified.
- `STACK_ID=1 make check-migration-safety` reached and passed the `assert` phase —
  "74 seeded row(s) across 39 table(s) survived intact".
- Convergence was re-checked by the epic owner with the scratch-workdir method after the
  `db diff --db-url` false-green was discovered (see below); genuinely empty, and the check was
  first proved capable of failing.

### Completion Notes List

- **Two amendments superseded this story's own AC text**, both because Story 12.3 landed first:
  a null `member_id` settles `skipped` rather than `failed` (Unassigned is a deliberate choice
  after 12.3, so `failed` would have held the new Settings heartbeat red forever), and the
  reworded delivery line names its recipient (after 12.3 the email goes to the assignee, so
  copy that said only "by email" would be false by omission).
- **Deviation 1 — `providers/supabase/dataProvider.ts` was modified**, though this story's
  declared file set lists it under "Explicitly NOT modified". `cron_heartbeat`'s primary key is
  `worker text`, not `id`, so `useGetOne("cron_heartbeat", { id: "cron" })` cannot resolve without
  a `PRIMARY_KEYS` entry. Four independent reviewers found this; without it AC-9's Settings row
  would have shipped permanently reading "couldn't check". The story text was simply wrong.
- **Deviation 2 — `task_notifications` gets `FORCE ROW LEVEL SECURITY`**, which this story's text
  explicitly said not to introduce. That text predates Story 7.5, which established exactly this
  posture for `message_notifications` and `push_subscriptions`, the closest twins of this table.
  Verified present at `05_policies.sql` before following the newer precedent.
- **Post-commit fix (cross-reconciliation pass).** `ReminderDeliveryStatus.tsx`'s `useGetOne` had
  no `retry: false`, so TanStack Query retried PostgREST's correct `406` on the empty-heartbeat
  state — which is the *normal* state until the cron Worker runs once. Settings rendered blank for
  7-9 seconds on every load, for every account. Caught by `e2e/reminder-delivery-status.spec.ts`,
  which had been written but never executed until the epic-level e2e round; the spec now passes
  in 1.9s where it previously timed out at 5s.
- **AC-10 is NOT satisfied.** "Delivered" means a real reminder email arriving at a real inbox.
  No Worker has been deployed since this code landed, so the cron sweep has never fired outside
  tests. This is the story's remaining definition-of-done item.

### File List

See commit `4446540` (29 files) and the post-commit fixes described above. New: the
`task_notifications` queue and `cron_heartbeat` table plus their migration and paired DB suite,
`workers/shared/resend.ts`, `workers/cron/sweepReminders.ts`,
`reminders/ReminderDeliveryStatus.tsx`, `e2e/reminder-delivery-status.spec.ts`. Modified: the
cron Worker and its `wrangler.toml` (the `[triggers]` schedule is now enabled),
`.github/workflows/deploy.yml`, `ReminderCreateSheet.tsx`, `settings/PreferencesSection.tsx`,
`providers/supabase/dataProvider.ts`, `types.ts`, both i18n catalogues, and the FakeRest
generators.
