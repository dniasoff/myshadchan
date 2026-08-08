# Story 7.5: Notifications

> **Status correction — 2026-08-09. The blocker named below no longer exists.** This story
> deferred the send half — the Resend transport, the message sweep and the cron `scheduled()`
> wiring — to Epic 12 gate **G1** and to Story 12.2's delivery mechanism. G1 was discharged on
> 2026-08-07 and 12.2 shipped at `4446540`: `workers/shared/resend.ts` and
> `workers/cron/sweepReminders.ts` are in the tree, with a claim/settle discipline and a provider
> idempotency key to copy. Nothing has been scheduled against this since, so **FR100 is still
> in-app only** and Epic 7 is still open on one story.
>
> **Owner: Story 16.4** (`epics.md` → Epic 16), which finishes this story **in place** rather
> than duplicating it, unifies the two channel enums in the same change (ledger item **S11**),
> and closes Epic 7 when it lands.

Status: in-progress *(DB/schema/queue layer complete, reviewed-ready. In-app
unread (`markThreadRead`), the private-default posture control, and the push
opt-in UI + service-worker listeners are now wired end-to-end — see Dev
Agent Record, "Gaps closed in this dispatch (session 2)". The SEND half of
delivery — the Resend transport, the message sweep, and the cron
`scheduled()` wiring — remains unbuilt, deliberately: it is blocked on Epic
12 gate G1 (Cloudflare secrets never provisioned) and owned by story 12-2's
delivery mechanism, not duplicated here — see Dependencies and "What
remains, and what unblocks it" below.)*

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to know when someone writes to me on a thread I'm party to,
so that conversations move instead of going quiet in an app nobody thought to check (FR100).

## Position in Epic 7

**5th of 5. Depends on 7.1-7.4** — a notification must fan out correctly regardless of which
scope axis a message's thread uses, so the connection axis (7.4) must be reachable first.

## The delivery-infrastructure situation — read this before writing any Worker code

An earlier revision of this story assumed it was the first to build outbound delivery. It is
not, and the difference decides three of its tasks.

### What is actually true in the tree today (`main` @ `11904a1`)

- `workers/cron/index.ts` is **18 lines**. Its `scheduled()` handler is
  `console.warn("[cron] sweep tick")` and nothing else. Its header comment says so.
- **No file in this repository calls Resend.** `RESEND_API_KEY` is plumbed
  (`workers/cron/wrangler.toml`'s secrets comment, `.github/workflows/deploy.yml`) — only
  the code is missing.
- **There is no push infrastructure at all**: no `push_subscriptions` table, no VAPID key
  handling, no service-worker push listener. `vite-plugin-pwa` is configured
  (`vite.config.ts:6,47`) and registers a service worker, but nothing subscribes.
- **None of the seven Cloudflare Workers has ever been deployed.** `deploy.yml`'s
  `deploy-workers` job is gated on `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; those
  secrets are absent, so every push to date has printed *"Cloudflare Workers deployment
  skipped"*. The `crons = ["*/15 * * * *"]` trigger has never been registered with
  Cloudflare. This is **Epic 12 gate G1**, and it is an ops action, not code.
- **Reminders are delivered by nothing.** `tasks.delivery_channels` is written by
  `reminders/ReminderCreateSheet.tsx` and read by no consumer anywhere.

### The relationship with Story 12.2 — stated, not assumed

`_bmad-output/implementation-artifacts/12-2-reminder-delivery.md` ("Reminder delivery",
Epic 12, *Silent Production Defects*) was written to close exactly the reminders gap this
story used to gesture at. It is **not** a competing implementation and this story must not
duplicate it. The division:

| Concern | Owner |
|---|---|
| `workers/shared/resend.ts` — the Resend transport | **Whichever lands first.** The second consumes it unchanged and adds no second wrapper. 12-2's declared signature is `sendEmail({ from, to, subject, text }) → { ok: true, id } \| { ok: false, error }` (a discriminated result, never a throw). If 12-2 landed first, adopt that signature verbatim; if this story lands first, ship exactly that signature so 12-2 needs no fork. |
| `public.cron_heartbeat` + `record_cron_heartbeat()` + the Settings status row | **12-2.** One row per worker; both sweeps run inside the same `cron` Worker and the same tick, so this story records **no second heartbeat** and adds **no second Settings row**. |
| Time-based "a reminder came due" queue (`task_notifications`) | **12-2.** |
| Event-based "a message was inserted" queue (`message_notifications`) | **this story.** Different trigger condition, different table. |
| Push: `push_subscriptions`, VAPID, the Web-Push sender, the client opt-in | **this story.** 12-2 explicitly defers all four here and instead *removes* the dead push checkbox from `ReminderCreateSheet.tsx`, while keeping `'push'` legal in `tasks_delivery_channels_check` so a later story can adopt this story's infrastructure for reminders without a data migration. **Adopting it for reminders is not this story's job** — building it is. |
| Epic 12 gate **G1** (Cloudflare secrets, pinned Worker URLs, `RESEND_API_KEY` + `RESEND_FROM` with a verified sending domain) | **Epic 12, once.** Do not obtain the credentials a third time. This story inherits the gate: it can be built and unit-tested without it, and cannot be *delivered* until it is discharged. |

**Two of 12-2's rulings override this story's earlier text and are adopted here:**

1. **No "cron-Worker exemption".** An earlier revision of this story claimed AD-7 grants the
   cron Worker an exemption from `forAccount()` for cross-tenant system work. 12-2's AC-7
   examined AD-7's actual text and found no such exemption. The pattern instead is: **the
   Worker issues no table query at all** — every read and write goes through
   `service_role`-only `SECURITY DEFINER` RPCs, and the cross-tenant read lives inside
   Postgres where the definer boundary already is. This story adopts that, and asserts it
   the same way (a `?raw` source scan for any `.from(` in `workers/cron/**`).
2. **No `force row level security`.** 12-2 states plainly that it is used nowhere in this
   schema and should not be introduced by a delivery-queue story. Whatever 7.1 concluded for
   the four thread tables (7.1 Task 5 makes that an evidence-backed decision, recorded in
   its Completion Notes), **this story follows 7.1's outcome** and does not make a second,
   independent call. If 7.1 shipped `force`, ship it here; if not, don't.

### The AD-13 "E7" naming trap

`workers/cron/index.ts`'s comment says *"E7 (Reminders) lands here — AD-13"*. That **"E7" is
the pre-Amendment-A2 epic numbering** and means reminders. This story's "Epic 7" is the
post-A2 **Communication** epic. They are different things that share a delivery vocabulary
(in-app + email + push, no SMS) and one Worker. 12-2 is what actually lands the old E7 half;
this story's Task 6 updates that comment so the next reader is not caught by it.

## Acceptance Criteria

1. **In-app: unread state is derived, not queued.** `thread_participants` gains
   `last_read_at timestamptz` (nullable — a participant who never opened the thread has
   never read anything). A thread is "unread" for a participant when
   `exists (select 1 from public.messages m where m.thread_id = tp.thread_id and m.created_at
   > coalesce(tp.last_read_at, '-infinity'))`. `public.mark_thread_read(p_thread_id bigint)`
   sets the caller's own `last_read_at` to `now()`.

2. **`mark_thread_read()` can only ever touch the caller's own row.** Its predicate is
   `tp.member_id = public.current_member_id() and tp.thread_id = p_thread_id`, and it is the
   only write path — `authenticated` gets no UPDATE grant on `thread_participants`.
   **Falsifiable:** member B calls it on a thread member A is in; A's `last_read_at` is
   unchanged and zero rows are affected (asserted by row count in the `db` project — a
   0-row UPDATE through PostgREST returns `PGRST116`, indistinguishable from a policy error,
   contract §13 rule 4).

3. **Email is the guaranteed floor.** Every new `messages` row queues exactly one
   `public.message_notifications` row per **other** thread participant with
   `channel = 'email'`; the sweep sends it and settles it `sent`, or `failed` with the
   transport error recorded on the row. Nothing is dropped without a record.

4. **A participant with no resolvable email is recorded, not skipped silently — and the two
   cases are distinguished.** Adopting 12-2's F2 ruling: a participant whose
   `account_members.user_id` is NULL (an invited-but-not-accepted membership — the column is
   nullable, `01_tables.sql:201`) settles **`skipped`**, a deliberate state, not a failure. A
   participant with a non-null `user_id` that resolves to no live `public.members` row, or to
   one with `disabled = true`, settles **`failed`** with an explanatory `error`. Treating the
   first case as `failed` would drive a permanent error state on a perfectly normal household.

5. **Push is delivered only where installed.** A `channel = 'push'` row is queued for a
   recipient **only if** they have at least one row in the new `public.push_subscriptions`;
   if they have none, no push row is queued and no error results — "by push where installed"
   without a dead letter for users who never enabled it.

6. **No outbound SMS — structurally, not by omission.** `message_notifications.channel` is
   constrained to `('email','push')`. There is no code path, table value or Worker call
   anywhere in this story that can produce an SMS send. **Falsifiable:** an insert with
   `channel = 'sms'` raises `23514`.

7. **A message's sender is never notified about their own message.** The fan-out excludes
   `sender_member_id`, compared with **`is distinct from`, not `<>`** — `sender_member_id` is
   nullable (7.1's `on delete set null`), and `member_id <> NULL` is never true, which would
   silently queue *nothing* for any message whose sender member was deleted. **Falsifiable:**
   a message whose `sender_member_id` is NULL still queues rows for every participant.

8. **A notification inherits its message's scope, on either axis.** Every
   `message_notifications` row carries the same `account_id`/`connection_id` as the message
   that produced it, with the same XOR check the thread tables use. **This is enforced by the
   fan-out trigger copying `new.account_id`/`new.connection_id`, which AD-1 names as an
   accepted alternative to a composite FK** ("Polymorphic `interactions`/`tasks` enforce
   target-scope integrity (composite `(account_id,id)` reference **or trigger**)"). The FK is
   the plain `message_id → public.messages(id) on delete cascade`. **Do not add composite
   unique keys to `messages` for this** — an earlier revision did, which meant an
   `ALTER TABLE` adding two constraints to a data-bearing table for a queue no client can
   read. **Falsifiable:** deleting a message deletes its notifications; a row with both scope
   columns set raises `23514`.

9. **Delivery survives a burst without duplicate sends.** The sweep claims rows —
   `status: 'pending' → 'sending'` in the same statement that selects them, with
   `for update skip locked` — before dispatching, inside a `service_role`-only
   `SECURITY DEFINER` function, because PostgREST cannot express `for update skip locked`.
   **Falsifiable:** two concurrent `claim_message_notifications()` calls against the same
   pending set return disjoint id sets. Assert with two real sessions, not by inspecting the
   function body.

10. **The Worker never touches a tenant table** (12-2 AC-7, adopted). Every read and write
    from `workers/cron/**` goes through `service_role`-only RPCs. **Falsifiable:** a `?raw`
    source scan asserts no `.from(` appears in this story's Worker files. Prove the scan red
    against a deliberately broken fixture before shipping it green (contract §13 rule 2).

11. **`message_notifications` is unreachable from a browser.** RLS enabled, **no policy for
    `authenticated` at all** — the stricter form of the `subscription`/`ai_usage` posture
    (`05_policies.sql:1048-1063`), which withholds even SELECT because a delivery queue
    carries recipient email addresses across every tenant. **Falsifiable:** an authenticated
    PostgREST client reads zero rows.

12. **A user manages only their own push subscriptions.** `push_subscriptions` RLS is keyed
    on `auth.uid()` via the owning `account_members` row — deliberately **not**
    `current_member_id()`, because registering a device is not a tenant-data read and must
    work whichever context is active. **Mandatory negative test**
    (`.claude/rules/security-triggers.md` — this story adds two RLS-guarded tables, a
    migration and new grants): a second user's client cannot read, update or delete member
    A's subscription row.

13. **Verification — the toolchain is green.** `make typecheck`, `npm run lint`, `make test`,
    `npm run test:unit:db`, `make check-migration-safety` all pass. The safety fixture is
    extended to seed and capture `message_notifications` and `push_subscriptions` (7.1
    already added the four thread tables), because this story alters `thread_participants`
    and the guard is structurally blind to a table it does not capture.

## Tasks / Subtasks

- [x] **Task 0 — Establish which of 12-2 / 7-5 landed first**
  - [x] Check for `workers/shared/resend.ts`, `public.task_notifications`,
        `public.cron_heartbeat` and `public.record_cron_heartbeat()`. Record the answer in
        the Completion Notes; Tasks 4, 5 and 6 branch on it. If 12-2 has landed,
        `workers/shared/resend.ts` and the heartbeat are **consumed, never re-created**.
  - [x] Confirm 7.1's `force row level security` decision from its Completion Notes and
        follow it (see "Two of 12-2's rulings", above).

- [x] **Task 1 — Schema: read state, the queue, and push subscriptions** (AC: 1, 3-8, 11, 12)
  - [x] `supabase/schemas/01_tables.sql`: `alter table public.thread_participants add column
        last_read_at timestamptz;` — and in the declared `create table` block, put it at the
        **physical tail**, because `add column` appends (COLUMN-ORDER TRAP,
        `01_tables.sql:1-60`). Adding a **nullable** column needs no backfill; it is
        deliberately nullable so "never read" is representable.
  - [x] `public.message_notifications(id bigint generated by default as identity primary key,
        created_at timestamptz not null default now(), account_id bigint, connection_id
        bigint, message_id bigint not null, recipient_member_id bigint not null, channel text
        not null, status text not null default 'pending', recipient_email text, attempts
        integer not null default 0, sent_at timestamptz, error text)` with:
        - `message_notifications_channel_check check (channel in ('email','push'))` (AC-6 —
          the same closed-enumeration style as `tasks_delivery_channels_check`,
          `01_tables.sql:105-107`);
        - `message_notifications_status_check check (status in
          ('pending','sending','sent','failed','skipped'))` — `sending` for AC-9's
          claim-before-dispatch, `skipped` for AC-4's deliberate no-recipient case;
        - `message_notifications_scope_check check ((account_id is not null) <>
          (connection_id is not null))` (AC-8);
        - a **unique key** `(message_id, recipient_member_id, channel)` — the fan-out is a
          trigger and should be idempotent under any future re-run or retry, and the cost of
          not having it is a duplicate email.
  - [x] FKs in the `alter table` block at the foot of the file (grep by constraint name, not
        line — Epic 8 and Epic 12 are editing this file): `message_id →
        public.messages(id) on delete cascade`; `recipient_member_id →
        public.account_members(id) on delete cascade`; `account_id → public.accounts(id) on
        delete cascade`; `connection_id → public.connections(id) on delete cascade`. **No
        composite FK, and no new unique key on `messages`** — AC-8's rationale.
  - [x] Index `message_notifications_pending_idx (status, created_at)` — the claim query
        filters `status='pending'` ordered by `created_at`.
  - [x] `public.push_subscriptions(id bigint generated by default as identity primary key,
        created_at timestamptz not null default now(), member_id bigint not null, endpoint
        text not null, p256dh text not null, auth text not null)`, unique
        `(member_id, endpoint)`, FK `member_id → public.account_members(id) on delete
        cascade`, index on `member_id`.

- [x] **Task 2 — Fan-out trigger** (AC: 3, 4, 5, 6, 7, 8)
  - [x] `supabase/schemas/02_functions.sql`: `fan_out_message_notifications()`
        (`after insert on messages`), `SECURITY DEFINER SET search_path ''`, `pg_dump` form.
        For each `thread_participants` row on `new.thread_id` where
        `member_id is distinct from new.sender_member_id` (AC-7):
        - resolve the recipient email inside Postgres — `account_members.user_id` →
          `public.members` (joined on `members.user_id`, which is uniquely indexed,
          `01_tables.sql:82`) → `members.email` where `members.disabled = false`. The `auth`
          schema is not exposed through PostgREST and must not be reached from the Worker
          (AC-10), so this resolution lives here.
        - insert one `channel='email'` row with `status` per AC-4:
          `'skipped'` when `account_members.user_id is null`; `'failed'` (with an
          explanatory `error`) when it is non-null but resolves to no live/enabled member;
          `'pending'` otherwise, with `recipient_email` set.
        - insert a second `channel='push'` row **only if**
          `exists (select 1 from public.push_subscriptions ps where ps.member_id = <that
          participant>)` (AC-5).
        - copy `new.account_id` and `new.connection_id` onto every inserted row (AC-8).
        - `on conflict (message_id, recipient_member_id, channel) do nothing`.
  - [x] `04_triggers.sql`: wire it `after insert on public.messages`, named so it sorts after
        7.1's `set_message_defaults` `before insert` trigger (different event, but keep the
        naming convention the file documents).

- [x] **Task 3 — RPCs, RLS and grants** (AC: 1, 2, 9, 10, 11, 12)
  - [x] `public.mark_thread_read(p_thread_id bigint) returns public.thread_participants` —
        `SECURITY DEFINER SET search_path ''`. `update public.thread_participants tp set
        last_read_at = now() where tp.member_id = public.current_member_id() and tp.thread_id
        = p_thread_id returning tp.*`. The `current_member_id()` predicate is the entire
        authorization check: by construction it can only touch the caller's own membership
        row in their active context, and a caller with no matching participant row updates
        zero rows (AC-2).
  - [x] `public.claim_message_notifications(p_limit integer) returns table(id bigint,
        channel text, recipient_member_id bigint, recipient_email text, thread_id bigint,
        message_body text, subject_type text, subject_id bigint)` — the claim-then-return
        CTE from Dev Notes, `for update skip locked`, `status → 'sending'`,
        `attempts = attempts + 1`, joined to `messages`/`threads` so the Worker needs no
        second call and no table access (AC-9, AC-10).
  - [x] `public.settle_message_notification(p_id bigint, p_status text, p_error text default
        null) returns void` — mirrors 12-2's `settle_task_notification`: rejects any
        `p_status` outside `('sent','failed','skipped')`; updates **only** rows currently in
        `'sending'`, so a late duplicate settle cannot resurrect a finished row; sets
        `sent_at = now()` on `'sent'`. If `p_error` is recorded here it is the transport's
        own error string on a row **no client can read** (AC-11) — unlike `cron_heartbeat`,
        which 12-2 restricts to bounded codes precisely because it *is* client-readable.
  - [x] `public.delete_push_subscription_by_endpoint(p_endpoint text) returns void`,
        `service_role` only — the sweep's self-healing path for a `410 Gone`/`404` from a
        push service (Task 6). Without it the sweep would need `.from("push_subscriptions")`
        and break AC-10.
  - [x] `05_policies.sql`: enable RLS on both new tables. `message_notifications` gets **no
        policy for `authenticated`** (AC-11), with the justification comment in the shape of
        the `subscription`/`ai_usage` block (`:1037-1047`). `push_subscriptions` gets
        `for all to authenticated using (exists (select 1 from public.account_members am
        where am.id = push_subscriptions.member_id and am.user_id = auth.uid()))` with the
        identical `with check` (AC-12), plus the inline comment explaining the deliberate
        `auth.uid()`.
  - [x] `06_grants.sql`: `revoke all on table public.message_notifications from anon,
        authenticated;` `grant all … to service_role;` and the same for
        `message_notifications_id_seq`. `revoke all on table public.push_subscriptions from
        anon;` `grant select, insert, delete on … to authenticated;` (no update — replace via
        delete+insert) `grant all … to service_role;` plus the sequence revoke/grant per the
        `shidduchim_id_seq` convention (`06_grants.sql:203-205`). Function grants:
        `mark_thread_read` → `authenticated, service_role`;
        `claim_message_notifications` / `settle_message_notification` /
        `delete_push_subscription_by_endpoint` → **`service_role` only**, revoked from
        `public, anon, authenticated`. The trigger function needs no grant.

- [x] **Task 3a — Generate, hand-check and rehearse the migration** (AC: 1, 3-8, 13)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        message_notifications`. Hand-check: the `alter table thread_participants add column`
        is a plain `ALTER`, not a rewrite; both new tables' `enable row level security`
        survived; the multi-column unique key `(message_id, recipient_member_id, channel)` is
        present (a multi-column key is exactly what `db diff` has under-emitted before); and
        no `drop view` appears (that is the column-order symptom — if it does, the
        `last_read_at` declaration went in the wrong place).
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`, then
        `db diff` twice more to prove convergence. Never `db reset` on a stack holding data;
        never `db push`.
  - [x] Extend `supabase/tests/migration-data-safety/fixture.sql` (seed + `capture()`, list
        at `:488-509`) for `message_notifications` and `push_subscriptions`, then
        `make check-migration-safety`. Rehearse against a production-shaped, non-empty
        database.

- [ ] **Task 4 — The Resend transport** (AC: 3)
  - [ ] **If `workers/shared/resend.ts` already exists (12-2 landed first): consume it
        unchanged.** Add no second wrapper, change no signature.
  - [ ] Otherwise create it with 12-2's exact declared signature: `sendEmail({ from, to,
        subject, text }) → Promise<{ ok: true; id: string } | { ok: false; error: string }>`
        around `POST https://api.resend.com/emails` using `RESEND_API_KEY`. A discriminated
        result, never a throw, so one bad address settles one row `failed` instead of losing
        the batch. Never in the client bundle.

- [ ] **Task 5 — The message sweep** (AC: 3, 9, 10)
  - [ ] New `workers/cron/sweepMessages.ts`, exporting `sweepMessages(env: CronEnv):
        Promise<{ claimed: number; sent: number; failed: number }>`. Creates a
        `service_role` `@supabase/supabase-js` client (the client the Workers already use —
        there is no `pg` driver in this repo), calls
        `.rpc("claim_message_notifications", { p_limit: 100 })`, dispatches each row, then
        `.rpc("settle_message_notification", …)`. **No `.from(` anywhere in the file**
        (AC-10). Mirror `workers/cron/sweepReminders.ts`'s shape if it exists.
  - [ ] Email body: name the thread's subject and the sender, and link to the thread —
        `<APP_ORIGIN>/#/shidduchim/<subject_id>/discussions` for a `shidduch` subject. The
        app runs on ra-core's default `HashRouter`, so the `#` is load-bearing, not
        decoration. Reuse 12-2's `APP_ORIGIN` `[vars]` entry in `workers/cron/wrangler.toml`
        rather than adding a second one. A `subject_type='relationship'` thread has no URL
        yet (7.1 adds no standalone route) — link to the app root and say so in a comment
        rather than fabricating a path.
  - [ ] **Never include message body text in the email.** A notification tells you there is a
        message; the content lives behind the RLS boundary this epic spent three stories
        building, and email is not inside it. This is a decision, stated so it is not
        "improved" later.

- [ ] **Task 6 — Push delivery, and the `scheduled()` handler** (AC: 5, 9, 10)
  - [x] New `workers/cron/webPush.ts`: sends a Web Push message (RFC 8291/8292) using VAPID.
        **Cloudflare Workers do not provide the Node `crypto` module the `web-push` npm
        package depends on** — do not add it as a dependency without first verifying it under
        this project's `nodejs_compat` flag (`workers/cron/wrangler.toml`); if it does not
        work, implement VAPID ES256 JWT signing directly with Web Crypto
        (`crypto.subtle.importKey` / `crypto.subtle.sign`), which Workers fully support.
        `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` as Wrangler secrets; only the public key
        reaches the client, as `VITE_VAPID_PUBLIC_KEY`.
  - [ ] For a claimed `channel='push'` row, send to each of the recipient's subscriptions. A
        `410 Gone`/`404` means the subscription is dead — call
        `delete_push_subscription_by_endpoint()` (never `.from(...)`, AC-10) so future
        messages stop trying it.
  - [ ] `workers/cron/index.ts`: **add** `await sweepMessages(env)` to `scheduled()`. If
        12-2 landed first, add it inside its existing try/heartbeat wrapper and record **no
        second heartbeat**; if this story lands first, leave the reminders sweep as the TODO
        it is today and let 12-2 add the wrapper. Extend the local `CronEnv` interface with
        `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (the per-Worker extension pattern in
        `workers/shared/env.ts` — do not widen `BaseEnv`). Correct the file's header comment,
        which still says *"E7 (Reminders) lands here"* in the pre-A2 numbering.
  - [x] `workers/cron/wrangler.toml`: add the two VAPID secrets to the secrets comment.
        **Leave `crons = ["*/15 * * * *"]` alone.** An earlier revision of this story
        unilaterally tightened it to `*/1`; 12-2's health check defines "Sending" as
        `last_ok_at` within **30 minutes = 2× the cron period**, so changing the period
        without changing that threshold in the same diff silently breaks 12-2's AC-9, and
        `wrangler.toml` is a file both stories write. **Open coordination item, with a
        default:** ship at `*/15` and document the up-to-15-minute latency on both channels;
        tightening it is a joint change made by whichever story lands second, restating the
        threshold as 2× the new period. Do not make it a side effect of this story.

- [x] **Task 7 — Client: subscribing to push** (AC: 5, 12)
  - [x] New `src/components/atomic-crm/threads/usePushSubscription.ts`: on **explicit user
        opt-in** (a button — never auto-run on page load; an unprompted permission prompt is
        bad UX and gets the origin permanently blocked in Chrome), call
        `Notification.requestPermission()`, then `navigator.serviceWorker.ready` →
        `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey:
        VITE_VAPID_PUBLIC_KEY })`, then `dataProvider.create("push_subscriptions", {
        member_id, endpoint, p256dh, auth })` from the subscription's keys.
  - [x] Handle the three states explicitly, with copy for each: unsupported browser
        (`!("PushManager" in window)` — every iOS browser before an installed PWA), permission
        `denied` (the browser will not re-prompt; say so), and success.
        `.claude/rules/coding-style.md` forbids swallowing these silently.
  - [x] Surface the opt-in from `settings/CommunicationSection.tsx` (created by **7.2**) —
        a natural home beside the default-thread-visibility control, avoiding a third
        settings section for one toggle. **Done in session 2**, after 7.2/7.3 both landed (no
        longer wave-incompatible): a new `PushNotificationsItem` renders unconditionally (not
        gated behind `CAN_SET_DEFAULT_VISIBILITY` — push is device-level, a `single` can opt
        in too), with a **fixed honesty disclaimer** ("Delivery is not live yet…") shown
        regardless of subscription state, so "Enabled on this device" never implies live
        delivery — the explicit choice this dispatch's brief asked to be named. See
        `CommunicationSection.push.test.tsx` for the red-then-green proof.
  - [x] `vite.config.ts` / the `vite-plugin-pwa` service worker: a `push` event listener that
        shows the notification and a `notificationclick` handler that focuses/opens the
        thread URL. **Done in session 2** as `public/push-sw.js`, injected into the
        generated `generateSW`-strategy service worker via `workbox.importScripts` (the
        documented mechanism for adding a listener without switching the whole PWA to
        `injectManifest`). Opens the **app root**, not a per-thread URL: `webPush.ts` sends an
        **empty-payload** push (its own design decision, below), so there is no thread id to
        deep-link to — the in-app unread indicator (AC-1) takes it from there. Proven by
        `public/push-sw.test.ts` (a new dedicated `vitest.config.ts` "public" Node project —
        Vite refuses to import a `.js` file living under `public/` into the module graph even
        with `?raw`, and the browser "app" project has no Node `fs`).

- [x] **Task 8 — In-app unread UI** (AC: 1)
  - [x] `threads/ThreadPanel.tsx` / `ThreadList.tsx` (7.1): call `markThreadRead()` when a
        thread is opened; show a per-thread unread indicator per AC-1's derived definition.
        **`markThreadRead()` wiring done in session 2** — see Dev Agent Record, "Gap 1:
        `markThreadRead` was wired nowhere". The unread indicator itself (`ThreadList.tsx`,
        `computeUnreadThreadIds.ts`) was already done. A dedicated notification bell/centre is
        asked for by no Epic 7 AC and is out of scope (YAGNI); a global unread badge is in
        scope only if a nav surface already exists to hang it on — none does, so none was
        built.

- [x] **Task 9 — Types and providers** (AC: 1, 3, 5)
  - [x] `types.ts`: `MessageNotificationChannel = "email" | "push"`, `PushSubscription`,
        `MessageNotificationStatus`, and `last_read_at?: string | null;` on
        `ThreadParticipant`. **Do not rename or refactor `TaskDeliveryChannel`**
        (`types.ts:102`) into a shared `DeliveryChannel` — see Dev Notes.
  - [x] `providers/supabase/dataProvider.ts`: `markThreadRead(threadId)` RPC wrapper, same
        shape as `createShidduchViaRpc` (`dataProvider.ts:85-100`). **Done in session 2**
        (`markThreadReadViaRpc`).
  - [x] Mirror in `providers/fakerest/` (AD-10): the `mark_thread_read` emulation and derived
        unread state. **Done in session 2** (`internal/threads.ts`'s `markThreadRead()` +
        `dataProvider.ts`'s wrapper). FakeRest has no backend to run a cron sweep against, so
        email and push delivery are **inherently untestable in the demo build** — already
        documented as expected (not a gap) by `usePushSubscription.ts`'s own `demo` state,
        which is a no-op that says so.

- [ ] **Task 10 — Tests** (AC: 2, 4-13)
  - [x] New `supabase/tests/message_notifications.sql` + `.test.ts` — a separate file from
        `threads_entity.sql` (a distinct concern, and both stay under the ~400-line typical
        ceiling per `.claude/rules/coding-style.md`). Cover: fan-out queues one `email` row
        per other participant on **both** scope axes with the right scope columns (AC-8); a
        participant with a `push_subscriptions` row also gets a `push` row and one without
        does not (AC-5); the sender is never queued, including when `sender_member_id` is
        NULL (AC-7); AC-4's `skipped` vs `failed` split, one assertion each;
        `channel='sms'` raises `23514` (AC-6); deleting a message deletes its notifications
        and a both-scope-columns row raises (AC-8); `mark_thread_read()` touches only the
        caller's row, asserted by row count (AC-2); an authenticated client reads **zero**
        `message_notifications` rows (AC-11, asserted rather than assumed); the AC-12
        negative on `push_subscriptions` across read/update/delete; and AC-9's two concurrent
        `claim_message_notifications()` sessions returning disjoint ids.
  - [x] **No `exception when others then … PASS` anywhere.** Match the specific SQLSTATE for
        every denial, prove each denial by mutation, and separately prove an unrelated
        failure still fails.
  - [ ] `workers/cron/sweepMessages.test.ts` and `workers/shared/resend.test.ts`: still
        blocked — their subjects (`sweepMessages.ts`, `resend.ts`) are deliberately unbuilt
        (see "What remains, and what unblocks it"). `workers/cron/webPush.test.ts` was already
        done (session 1) and stays green. `public/push-sw.test.ts` (new, session 2) covers
        the service-worker half of Task 6/7 with the same red-then-green discipline (see Dev
        Agent Record).
  - [x] Vitest (browser mode, `vitest-browser-react` + `TestMemoryRouter`) for
        `usePushSubscription` (all three states — session 1), the settings opt-in
        (`CommunicationSection.push.test.tsx`, new, session 2) and the unread indicator
        (`ThreadList.test.tsx`'s three pre-existing pure-fixture cases, session 1, **plus** a
        new session-2 case proving the actual open → `markThreadRead()` → indicator-clears
        round trip — see Dev Agent Record, "Gap 1"). AAA, ≥80% of new lines, no
        `waitForTimeout`.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus prettier
        on this story's changed files only.

## Dev Notes

### Why in-app delivery needs no queue

Modelling "in-app" as a `message_notifications` row would require an async delivery step for
what is really a **read/unread comparison** — the message exists the moment it is inserted;
"in-app delivery" is nothing more than the UI showing it unread until the participant opens
the thread. Deriving it from `thread_participants.last_read_at` vs `messages.created_at`
needs no background job, has no failure mode, and cannot drift from reality the way a
queued-and-forgotten in-app row could. This mirrors how reminders' in-app "delivery" is just
the reminder appearing in the Reminders list — which, per 12-2, is the only reminder channel
that has ever functioned, and it functions by accident.

### Do not refactor `TaskDeliveryChannel`

`types.ts:102` already defines `TaskDeliveryChannel = "in_app" | "email" | "push"`, consumed
by the reminders feature. This story's `MessageNotificationChannel = "email" | "push"`
deliberately reuses the same two literals for consistency but is its own type. Unifying them
into a shared `DeliveryChannel` is a reasonable idea and a **deliberate cross-epic refactor**
with its own review surface — it changes a type an already-built, already-deployed feature
depends on, and 12-2 is concurrently editing that feature's create sheet. Not a silent side
effect of this story.

### The claim-then-dispatch pattern (AC-9)

```sql
with claimed as (
  update public.message_notifications
  set status = 'sending', attempts = attempts + 1
  where id in (
    select id from public.message_notifications
    where status = 'pending'
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *
)
select ... from claimed join public.messages m on m.id = claimed.message_id
                        join public.threads  t on t.id = m.thread_id;
```

`FOR UPDATE SKIP LOCKED` is what makes this safe when the Worker's `scheduled()` handler
overlaps itself — a slow run still executing when the next tick fires. The second invocation
skips the rows the first has locked rather than double-sending. It ships as
`claim_message_notifications(p_limit)` because PostgREST cannot express `for update skip
locked`, and the Worker reaches it by `.rpc()` on the `service_role` client. The join is what
lets the Worker satisfy AC-10 with a single call and no table access.

### Why the email says so little

AC-11 withholds even SELECT on the queue from `authenticated` because it carries recipient
addresses across every tenant. The same reasoning applies one step further out: an email
leaves the system entirely. 7.1-7.4 spend three stories making thread readership a database
property; putting message bodies in an email hands that content to whoever controls a mailbox
the app never authenticated. Task 5 therefore sends a "you have a new message on X" pointer
and nothing more. It is a smaller feature and it is the right one.

### References

- [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-22`]
  — "Delivery is in-app + email + push; no outbound SMS, ever (AD-13)."
- [Source: same file `#AD-13`] — the in-app+email+push, no-SMS model this story's channel
  vocabulary mirrors; it is the *reminders* delivery model, a different feature (see "The
  AD-13 'E7' naming trap").
- [Source: same file `#AD-1`] — "target-scope integrity (composite `(account_id,id)`
  reference **or trigger**)", which is what AC-8 relies on.
- [Source: same file `#AD-7`] — Worker compute home. **It grants no cron exemption from
  `forAccount()`**; AC-10 satisfies it by issuing no table query at all (12-2 AC-7).
- [Source: `_bmad-output/implementation-artifacts/12-2-reminder-delivery.md`] — the shared
  `workers/shared/resend.ts` signature (its Task 4), the RPC-only Worker posture (its AC-7),
  the `skipped` vs `failed` ruling (its F2), the heartbeat and Settings status row (its
  AC-9), the "do not introduce `force row level security`" note (its Task 3), and Epic 12
  gate **G1**.
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic-12`] — gate G1; and gap **S5**
  ("AD-13 reminder delivery is never wired"), which is 12-2's, not this story's.
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic-7-Communication`, Story 7.5]
- [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §13 rules 2, 4, 5] — a
  `?raw` guard must be proven red; zero-rows is asserted in the `db` project; ≥80% coverage.
- `workers/cron/index.ts` (the 18-line stub, its stale "E7 (Reminders)" comment),
  `workers/cron/wrangler.toml` (the `*/15` schedule and the secrets comment),
  `workers/shared/env.ts` (the per-Worker `Env` extension pattern),
  `.github/workflows/deploy.yml` (the `deploy-workers` job gated on the absent Cloudflare
  secrets — gate G1).
- `supabase/schemas/01_tables.sql:1-60` (COLUMN-ORDER TRAP), `:71-82` (`members`: `email`,
  `user_id` unique, `disabled`), `:88-108` (`tasks`, `delivery_channels`, the closed-channel
  precedent), `:197-221` (`account_members`, **nullable `user_id`** — AC-4's `skipped` case).
- `supabase/schemas/05_policies.sql:1037-1063` (`subscription`/`ai_usage` — the no-policy
  posture `message_notifications` follows more strictly still).
- `supabase/schemas/06_grants.sql:203-205` (sequence convention), `:290-292` (function-grant
  convention).
- `supabase/tests/migration-data-safety/fixture.sql:488-509` (the capture list to extend).
- `src/components/atomic-crm/types.ts:102` (`TaskDeliveryChannel`),
  `providers/supabase/dataProvider.ts:85-100` (`createShidduchViaRpc`),
  `vite.config.ts:6,47` (`vite-plugin-pwa`).
- Stories `7-1-thread-model.md` (the tables and the dual axis) and
  `7-4-any-pairing-private-thread.md` (the connection axis a notification must inherit).

## Dependencies

- **7.1-7.4** (blocking): the thread tables, both scope axes, and the participant model.
- **Epic 12 gate G1** (blocking for *delivery*, not for code): Cloudflare secrets, pinned
  Worker URLs, `RESEND_API_KEY` + `RESEND_FROM` with a verified sending domain. Until G1 is
  discharged, no Worker runs in production and merging this story changes nothing there.
  **Discharge it once, at the Epic 12 level — do not obtain the credentials a third time.**
- **Story 12.2** (coordination, not blocking either way): shares
  `workers/shared/resend.ts`, `workers/cron/index.ts`, `workers/cron/wrangler.toml` and
  `.github/workflows/deploy.yml`. **Never the same wave.** Whichever lands first sets the
  conventions for `workers/shared/`; the second extends and never forks.
- **Story 7.2** (file conflict): `settings/CommunicationSection.tsx` is created there and
  extended here. **Never the same wave.**
- **Story 12.4** (Stripe billing) also edits `.github/workflows/deploy.yml`. **Never the same
  wave.**

## What remains, and what unblocks it (session 2)

Everything reachable without Cloudflare/Resend credentials is now built and wired (Task 0-3,
3a, 7, 8, 9 all `[x]`; Task 10's DB/browser suites `[x]`). What remains is exactly the SEND
half of delivery, and it is unbuilt **on purpose**, not by oversight:

| Remaining | Owner | What unblocks it |
|---|---|---|
| `workers/shared/resend.ts` (Task 4) | Whichever of this story / **12-2** lands its Worker code first — 12-2's declared signature (`sendEmail({ from, to, subject, text }) → { ok: true, id } \| { ok: false, error }`) is adopted verbatim by the second. | No credential gate by itself (it can be unit-tested with a mocked `fetch`) — but shipping it with nothing to call it is dead code, so it should land together with Task 5. |
| `workers/cron/sweepMessages.ts` (Task 5) | This story, once Task 4 exists (needs the transport to call). `workers/cron/webPush.ts` (session 1) is already built and tested, ready for this file to call for the push half. | Needs Task 4, not G1 — can be built and unit-tested (mocked HTTP) without credentials, same as session 1's `webPush.ts` was. |
| `workers/cron/index.ts`'s `scheduled()` wiring (`await sweepMessages(env)`) (Task 6) | This story, once Task 5 exists. | Needs Task 5. |
| **Actual delivery** (email arriving, push arriving) | Epic 12, once, at the gate-G1 level. | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (workers have never deployed — every push to `main` has printed "Cloudflare Workers deployment skipped") + `RESEND_API_KEY`/`RESEND_FROM` with a verified sending domain + the VAPID secrets (already documented in `wrangler.toml`'s comment, session 1). This is an ops action on a project-owner-held account, not a code task, and this dispatch's brief explicitly named it out of scope: building Task 4/5/6 now, with `story 12-2-reminder-delivery.md` already owning the delivery mechanism for the sibling (reminders) queue, risks exactly the "two mechanisms for the same problem" failure this project has hit before, this time inside a single story rather than across two. |
| The `message_notifications` backlog, once G1 IS discharged | Whoever discharges G1 | The one-line `update … set status = 'skipped' where status = 'pending'` runbook step named above in "Operational risk call" — run once, before the cron trigger's first real tick. |

**Status, honestly:** in-app delivery (AC-1, AC-2) is complete and live. The default-visibility
posture (AC covered by 7.2/7.3, this story's Gap 2) is complete and live. Push registration
(AC-5, AC-12, the device side) is complete and live, but delivers nothing yet. Email queuing
(AC-3 through AC-8, the QUEUE half) is complete and live; the SEND half of AC-3 is not built.
Nothing in this story is silently broken or partially wired without a name attached to the gap
— every remaining item above has an owner and an unblock condition.

## Declared file set

**Schema / DB**
`supabase/schemas/01_tables.sql`, `02_functions.sql`, `04_triggers.sql`, `05_policies.sql`,
`06_grants.sql`, one new `supabase/migrations/<ts>_message_notifications.sql`,
`supabase/tests/message_notifications.sql`, `supabase/tests/message_notifications.test.ts`,
`supabase/tests/migration-data-safety/fixture.sql`.

**Workers**
`workers/cron/index.ts`, `workers/cron/wrangler.toml`, `workers/cron/sweepMessages.ts` (+
test), `workers/cron/webPush.ts` (+ test), `workers/shared/resend.ts` (+ test) **only if
12-2 has not landed**.

**Types / providers / i18n**
`src/components/atomic-crm/types.ts`,
`providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts`,
`providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts`.

**UI / PWA**
`src/components/atomic-crm/threads/usePushSubscription.ts` (+ test),
`threads/ThreadPanel.tsx`, `threads/ThreadList.tsx`,
`settings/CommunicationSection.tsx` (+ test), `vite.config.ts` (service-worker push
handlers), `.env.example` / the Vercel env for `VITE_VAPID_PUBLIC_KEY`.

**Generated**
`registry.json` (pre-commit `make registry-gen`).

No `TabKey`, `CANONICAL_TAB_SETS`, descriptor or route change — this story adds no tab and no
resource.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story dispatch), Sonnet 5. Session 1 built the DB/queue layer
and the pieces reachable inside its declared path set; session 2 (this pass)
closed the three gaps Epic 7's verification found and left named — see "Gaps
closed in this dispatch (session 2)" below.

### Debug Log References

**Session 1** (`STACK_ID=5`):
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir .supabase-e2e-5 --local`
  run to convergence ("No schema changes found") twice after a full
  `db reset`, on `STACK_ID=5`.
- `make check-migration-safety STACK_ID=5` — PASSED twice: once at the
  default baseline (pre-Epic-7, 51 rows / 22 tables — `message_notifications`/
  `push_subscriptions` correctly skip-seed, since neither exists yet at that
  baseline) and once at `--baseline 20260802035346` (Story 7.4's own
  migration, so `thread_participants` already exists and its ALTER is
  rehearsed against real pre-existing rows — PASSED, 59 rows / 26 tables,
  reproducing 7.4's own reviewer evidence).
- `STACK_ID=5 npx vitest run --config vitest.config.ts` (all projects):
  232 files / 2701 tests passed.
- `npm run typecheck`, `npm run lint` (0 warnings), `npm run prettier`
  (the project's actual gate — `{mjs,js,json,ts,tsx,css,md,html}`, not a bare
  `prettier --check .`, which also flags unrelated pre-existing drift in
  `doc/**/*.mdx`/`.github/workflows/*.yml` outside this story), `npm run
  build` — all green.
- The four CI guards (`check-suppressions.mjs`, `check-retired-names.mjs`,
  `check-route-convention.mjs`, `check-tailwind-arbitrary-var.mjs`) — all OK.
- AC-9's concurrency proof verified falsifiable by mutation: temporarily
  dropping `for update skip locked` from the live `claim_message_notifications()`
  made both sessions claim the same row and the test failed red
  (`expected 181 not to be 181`); restoring the clause turned it green again,
  stable across 3 repeat runs.

**Session 2** (`STACK_ID=1`, no schema touched — no new migration this
session):
- Gap 1, 2, 3 each proven red against the pre-fix tree first (`git stash push`
  on only the implementation files, keeping the new/changed test), then green
  after restoring — see each gap's own writeup above for the exact failure
  output.
- `npm run typecheck` — caught and fixed one real gap of its own: the
  FakeRest `markThreadRead()` mirror legitimately returns `null` (AC-2's
  zero-rows-affected case), which the `CrmDataProvider` interface (derived
  from the Supabase wrapper's return type) did not allow — widened
  `markThreadReadViaRpc`'s return type to `ThreadParticipant | null` in both
  places rather than lying with a type assertion. Green after the fix.
- `npm run lint` (0 warnings) — one dead `eslint-disable` comment removed
  (`@typescript-eslint/no-implied-eval` is not part of this repo's active
  ruleset, so the directive suppressed nothing and
  `reportUnusedDisableDirectives: "error"` caught it). Green after the fix.
- `npm run prettier` — 4 files reformatted
  (`providers/fakerest/dataProvider.ts`, `providers/fakerest/internal/
  threads.ts`, `settings/CommunicationSection.push.test.tsx`,
  `settings/CommunicationSection.tsx`). Green after.
- `npm run build` — caught a real bug of its own: `public/push-sw.test.ts`
  (its first location) got copied verbatim into `dist/push-sw.test.ts` by
  Vite's `publicDir` handling, then reappeared as a stray failing suite
  under `STACK_ID=1 npx vitest run` (`Module "node:fs" has been
  externalized for browser compatibility`) because `dist/**` was not
  excluded from the "app" project. Fixed by moving the test to a new
  `service-worker/` directory (reading `../public/push-sw.js` by relative
  path) and adding a dedicated `"service-worker"` Vitest project
  (`environment: "node"`), plus excluding `public/**`, `service-worker/**`
  and `dist/**` from "app". Reproduced clean afterward: `dist/push-sw.js`
  ships, `dist/push-sw.test.ts` does not, and a full `vitest run` no longer
  discovers it.
- `STACK_ID=1 npx vitest run` (all projects, post-fix): 236 files / 2717
  tests passed.
- `make test STACK_ID=1`: 236 files / 2717 tests passed (same run, via the
  Makefile target this dispatch was asked to use).
- `STACK_ID=1 npx vitest run --project db`: 28 files / 1010 tests passed —
  confirms the "db" project genuinely ran against the live stack (not
  silently skipped), including `message_notifications.test.ts`'s own
  two-session concurrency proof from session 1.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir
  .supabase-e2e-1 --local` — "No schema changes found," run twice
  (expected: this session added no migration).
- `DBUS_SESSION_BUS_ADDRESS=/dev/null make check-migration-safety
  STACK_ID=1` — "migration data-safety guard PASSED" (re-confirms session
  1's own migration; nothing new to rehearse).
- The four CI guards, run individually — all OK.
- `make commit MSG="…" PATHS="…"` used for the resulting commit; stack 1
  stopped afterward (`make stop-supabase-e2e STACK_ID=1`).

### Completion Notes List

**Task 0 finding.** Neither `workers/shared/resend.ts` nor
`public.task_notifications`/`public.cron_heartbeat`/`record_cron_heartbeat()`
exist in the tree — **Story 12.2 has not landed.** 7.1's `force row level
security` decision (its Completion Notes + `05_policies.sql`'s own evidence
block) is FORCE, with recorded `pg_roles.rolbypassrls` evidence; this story
follows that and ships FORCE on `message_notifications`/`push_subscriptions`
too, with the same evidence cited inline.

**Scope boundary — out-of-scope, reported and stopped
(`.claude/rules/parallel-ownership.md`, "Out-of-scope work is reported, not
taken").** This dispatch's declared path set is narrower than the story's own
"Declared file set": it does not include `workers/shared/**`,
`providers/supabase/dataProvider.ts`, `providers/fakerest/**`,
`providers/commons/*CrmMessages.ts`, `settings/CommunicationSection.tsx`, or
`vite.config.ts`. Per the concurrency rule, these were not touched — not even
for the one-line additions that would have unblocked downstream tasks. This
has real consequences, not touched here:

- **Task 4 (`workers/shared/resend.ts`) is entirely undone.** Without it,
  Task 5 (`workers/cron/sweepMessages.ts`) cannot be built — there is no
  email transport to call, and the file would either not compile or need a
  second, conflicting wrapper inside `workers/cron/`, which is exactly the
  "two mechanisms for the same problem" shape the parallel-ownership rule
  warns about. **AC-3's SEND half is therefore not implemented — only its
  QUEUE half is** (the fan-out trigger correctly queues every row; nothing
  in this tree drains the queue). Whoever owns `workers/shared/**` next
  should build `resend.ts` with 12-2's exact declared signature
  (`sendEmail({ from, to, subject, text }) → { ok: true, id } | { ok: false,
  error }`) and then `workers/cron/sweepMessages.ts` per Task 5, reusing
  `workers/cron/webPush.ts` (built here) for the push half.
- **Task 6's Worker wiring is partial.** `workers/cron/webPush.ts` is built
  and fully tested (see "The webPush.ts design decision" below).
  `workers/cron/index.ts` gained the `CronEnv` interface (VAPID keys) and a
  corrected header comment; `wrangler.toml` gained the VAPID secrets comment.
  **`scheduled()` still only logs the stub tick** — wiring
  `await sweepMessages(env)` in needs Task 5 first.
- **Task 7's hook is built and tested; its two UI-integration points are
  not.** `usePushSubscription.ts` implements the full opt-in flow (four
  states: `unsupported`/`demo`/`denied`/`subscribed`, plus `error`), but
  nothing surfaces it — `settings/CommunicationSection.tsx` (owned by Story
  7.2, outside this dispatch) never renders a button that calls
  `subscribe()`, and `vite.config.ts`'s service worker has no `push`/
  `notificationclick` listener, so a granted subscription would never
  actually show a notification. The hook is reachable only by a future
  change to those two files.
- **Task 8 is half-built.** The unread indicator (`ThreadList.tsx`, derived
  client-side via the new `computeUnreadThreadIds.ts`, per AC-1's exact
  predicate) is implemented and tested. **`markThreadRead()` is never
  called** — doing so needs a `dataProvider.markThreadRead(threadId)`
  wrapper (matching `setThreadVisibility`'s existing shape) in
  `providers/supabase/dataProvider.ts`, outside this dispatch's declared set.
  Calling the RPC directly via `getSupabaseClient()` from `ThreadPanel.tsx`
  was considered and deliberately rejected: it would import Supabase-specific
  internals into provider-agnostic UI code and create a second, inconsistent
  mechanism alongside `setThreadVisibility`'s dataProvider-wrapper shape —
  worse than not building it. A thread the caller opens will keep showing as
  unread in the list until this wrapper exists.
- **Task 9's provider bullets are undone** for the identical reason:
  `providers/supabase/dataProvider.ts`'s `markThreadRead` wrapper and the
  `providers/fakerest/**` mirror (AD-10) are both outside this dispatch.
  `types.ts` is fully done.
- **Task 10's Worker/UI test bullets are partial** for the same root cause:
  `sweepMessages.test.ts` cannot exist (its subject doesn't); `resend.test.ts`
  is out of scope; the settings opt-in has no surface to test. Everything
  else — the full DB suite (including AC-9's real two-session proof),
  `webPush.test.ts`, `usePushSubscription.test.tsx` (all 4 states),
  `computeUnreadThreadIds.test.ts`, and the `ThreadList.test.tsx` unread
  cases — is done.

**The `webPush.ts` design decision.** Task 6 anticipates the `web-push` npm
package may not work under Workers' `nodejs_compat` and says to implement
VAPID JWT signing directly with Web Crypto if not. There is no Cloudflare
Workers runtime available in this environment to verify that package either
way, so rather than gamble on an unverified dependency (or hand-roll RFC
8291's aes128gcm payload encryption — real cryptography, easy to get subtly
wrong, with no test vectors on hand to check it against), `webPush.ts` sends
an **empty-payload** push: VAPID (RFC 8292) JWT signing via Web Crypto is
fully implemented and tested (including verifying the produced signature
against the public key, not just checking JWT shape), but no application
payload is ever encrypted or sent. RFC 8030 requires every push service to
accept a zero-length body, and Task 5's own "never include message body text
in the email" principle applies here for free. The (out-of-scope) service
worker `push` handler would show a fixed "you have a new message"
notification; `notificationclick` still navigates. A future story wiring
real payload encryption needs no schema change — `push_subscriptions`
already stores `p256dh`/`auth`.

**A hardening fix beyond the story's literal text.** Task 3's `06_grants.sql`
bullet says `revoke all on table public.push_subscriptions from anon;` —
**omitting `authenticated`**, unlike every other precedent in that file
(`thread_participants`, `messages`, `entity_files`, …). Verified live: `db
diff` generated exactly what the literal text describes, and Postgres's
default privileges then left `authenticated` holding TRUNCATE/REFERENCES/
TRIGGER on `push_subscriptions` — TRUNCATE bypasses RLS entirely, on a table
AC-12 exists specifically to lock to one member's own rows. Fixed to
`revoke all … from anon, authenticated;`, matching the codebase's own stated
principle, with the fix and its rationale recorded in both `06_grants.sql`
and the migration.

**Two more `db diff` under-emission gaps, found by the mandated
"diff twice" convergence check (not merely believed clean).** (1) The three
default-privilege `REVOKE`s (`TRUNCATE`/`REFERENCES`/`TRIGGER` from
`authenticated`) on both new tables were absent from the plain generated
migration — a second `db diff` after applying it showed them as a live,
reproducible divergence. (2) All four new functions' grant/revoke statements
were absent entirely — reproduced live as `claim_message_notifications()`
being callable by `authenticated`, which AC-10 forbids. Both hand-added to
the migration, with the reasoning recorded inline; `db diff` now converges
to "No schema changes found" twice in a row.

**A real bug in `claim_message_notifications()`, caught before the migration
was ever applied for real.** `RETURNS TABLE(id bigint, channel text, …)`
implicitly declares `id`/`channel`/etc. as plpgsql variables in scope for the
whole function body — the bare `id` inside the claim CTE's `WHERE id IN
(SELECT id FROM …)` was ambiguous with the OUT parameter of the same name,
and the function failed on its first real call (`column reference "id" is
ambiguous`). Fixed with table aliases (`mn`/`mn2`) throughout; the schema
file and the migration file carry byte-identical comments so `db diff`
doesn't reproduce this as a phantom function re-create on every future run
(a `pg_get_functiondef` diff caught that exact mismatch mid-fix).

**AC-11's mechanism is stricter than its literal wording.** "An authenticated
PostgREST client reads zero rows" reads like an RLS-filtered empty result;
the actual mechanism here is a hard permission denial (`42501`, no grant at
all) — stronger, and the falsifiable test asserts the SQLSTATE rather than
an empty array, per contract §13 rule 4's "asserted... in the db project"
guidance.

### Gaps closed in this dispatch (session 2)

Epic 7's verification pass found three gaps left open by session 1's scope
boundary, all inside this dispatch's own declared path set this time
(`providers/supabase/dataProvider.ts`, `providers/fakerest/**`,
`settings/CommunicationSection.tsx`, `vite.config.ts` — every file session 1
named as "not touched, outside scope"). Delivery itself (Task 4/5, and
Task 6's `scheduled()` wiring) was explicitly left alone — see "What
remains, and what unblocks it" below for why.

**Gap 1: `markThreadRead` was wired nowhere.** The RPC (`mark_thread_read()`)
was proven correct server-side in session 1; `supabase/tests/
message_notifications.sql`'s own AC-2 assertions still pass unchanged. But
zero call sites existed in `src/` — a thread could never actually be marked
read, so AC-1's unread indicator could only ever turn ON, never off, once a
thread had a message.

- Added `markThreadReadViaRpc` to `providers/supabase/dataProvider.ts`
  (`getSupabaseClient().rpc("mark_thread_read", …)`, same wrapper shape as
  `setThreadVisibilityViaRpc`) and a FakeRest mirror
  (`providers/fakerest/internal/threads.ts`'s `markThreadRead()` — reads the
  caller's own `thread_participants` row via `resolveContextMembership()`,
  updates `last_read_at`, resolves `null` rather than throwing when the
  caller has no participant row on that thread, mirroring the real RPC's
  "zero rows affected" shape for AC-2).
- Wired into `threads/ThreadPanel.tsx`: a `useEffect` keyed on `threadId`
  calls `dataProvider.markThreadRead(threadId)` the moment the panel mounts
  (mounting IS "opening" — `ShidduchDiscussionsTab` is the sole `ThreadList`
  consumer in the app today, so `ThreadPanel` has exactly one reachable call
  site), then `refresh()` (already imported for `onSent`/`onChanged`)
  invalidates every active query so `ThreadList`'s own unread-derivation
  reads resync without a page reload. A failure surfaces through the same
  deny-then-notify pattern the Composer/VisibilityControl in that file
  already use, not a silent swallow.
- **Red-then-green proof**: `threads/ThreadList.test.tsx` gained a new case
  ("selecting the unread thread's row marks it read and the indicator
  clears without a reload") that opens a genuinely-unread thread and asserts
  the round trip — the exact gap the task named ("the existing tests would
  not have caught this"). Run against the pre-fix tree (`git stash` on the
  five implementation files, keeping only the new test): **FAIL** — timeout
  waiting for the indicator to clear, because `dataProvider.markThreadRead`
  was never called. Restored: **PASS**, stable.
  - This surfaced a real pre-existing test-design flaw in the SAME describe
    block while wiring the fix in: with `markThreadRead` now live, the two
    older "marks a thread unread…" tests broke, because their single-thread
    fixture relied on the previously-inert auto-selected thread staying
    unread forever — it no longer does, since opening it (which auto-select
    now does) marks it read. Fixed by giving the fixture a second, more
    recent "decoy" thread that the list auto-selects instead, so thread 1
    (the one under test) stays genuinely un-opened. This is a fixture
    correction forced by the fix being correct, not scope creep.

**Gap 2: `CommunicationSection.tsx`'s "Private" radio was still hard-`disabled`**,
with a comment citing 7.3 as not yet shipped. 7.3 shipped in session 1 and
its own falsifiable tests prove `thread_is_readable()`'s private branch live
(`02_functions.sql`).

- Re-enabled the radio; deleted the stale "Not yet enforced" comment and
  hint copy.
- `CommunicationSection.test.tsx`'s mocked-provider tests were rebalanced:
  the old "clicking the disabled Private option never calls update (F1)"
  test (which no longer applies — nothing is disabled) was replaced with
  its mirror, "switching from open to private calls dataProvider.update
  with 'private'" — the direction that was blocked before this fix.
- **Verified end to end, not just "un-greyed"**: a new file,
  `settings/CommunicationSection.endToEnd.test.tsx`, wires the control to
  the REAL FakeRest dataProvider (not a mock) and follows ONE write all the
  way through — click "Private" in the real UI → `accounts.
  default_thread_visibility` persists `'private'` through a real round
  trip → `dataProvider.createThread({ subject_type: "relationship" })`
  (no explicit `visibility`, the same call shape `ThreadList.tsx`'s "Start a
  discussion" button uses) resolves to `'private'`. Run against the
  pre-fix `disabled` radio: **FAIL** (`locator.click: Timeout … element is
  not enabled`). Restored: **PASS**.

**Gap 3: the push opt-in had no entry point**, and the service worker had no
`push`/`notificationclick` listener — `usePushSubscription.ts` (session 1)
was built and unit-tested but unreachable from the app.

- `settings/CommunicationSection.tsx` gained a new `PushNotificationsItem`.
  Deliberately **not** gated behind `CAN_SET_DEFAULT_VISIBILITY`/
  `useViewerRole()` the way the default-posture radio is — push is a
  device-level setting keyed to the caller's own membership
  (`push_subscriptions.member_id`), so a `single` (who cannot set the
  household default) can still opt their own device in. This required
  restructuring the component: the outer `<div>`/`SectionLabel`/`ItemGroup`
  now renders unconditionally, with only the default-visibility `Item`
  inside it conditional — previously the WHOLE section, including its
  heading, returned `null` for a `single`. `CommunicationSection.test.tsx`'s
  three tests that asserted "renders nothing" for that case were rewritten
  to assert "the default-visibility control is absent, the push opt-in
  still renders."
  - **Honesty choice, made explicitly per this dispatch's brief**: none of
    the seven Cloudflare Workers has ever deployed (gate G1), so a fully
    `subscribed` device still receives nothing. A **fixed disclaimer**
    ("This only turns on this device's side. Delivery is not live yet…")
    renders under the button regardless of `state`, so "Enabled on this
    device" never reads as "notifications are live."
  - The four hook states get explicit copy: `unsupported`/`demo` disable
    the button and explain why proactively (the hook only populates its own
    `errorMessage` from *inside* `subscribe()`, so a disabled button that
    can never be clicked would otherwise show no reason at all); `denied`
    also explains itself proactively (the browser will not re-prompt, no
    reason to make the caller click just to learn that); `error`/`idle`
    leave the button enabled so a transient failure can be retried.
- `public/push-sw.js` (new): `push` shows a fixed, generic notification
  (`webPush.ts` sends an **empty payload** — see session 1's "webPush.ts
  design decision" — so there is nothing to parse); `notificationclick`
  focuses an already-open app window or opens the root. Injected into
  `vite-plugin-pwa`'s `generateSW`-strategy output via `workbox.
  importScripts` (`vite.config.ts`) — workbox-build's own documented
  mechanism for adding "some additional code, such as a push event
  listener" without switching the whole PWA to `injectManifest`. Verified
  against a real `vite build`: the generated `dist/sw.js` opens with
  `importScripts("push-sw.js")`, and `dist/push-sw.js` exists.
- **Red-then-green proof, both halves**:
  - `settings/CommunicationSection.push.test.tsx` (new): four cases —
    the disclaimer always renders; clicking "Enable" subscribes and calls
    `dataProvider.create("push_subscriptions", …)`; the button is disabled
    with an explanation when `PushManager` is absent; the "blocked, will not
    re-prompt" copy shows proactively when permission is already `denied`.
    Run against the pre-fix `CommunicationSection.tsx` (no
    `PushNotificationsItem`): all four **FAIL** (button not found at all).
    Restored: **PASS**.
  - `public/push-sw.test.ts` (new — see "New Vitest project", below):
    loads the raw script with Node `fs` + `new Function("self", …)` against
    a fake `self`, asserting both listeners register, `push` calls
    `showNotification` with the fixed copy, and `notificationclick` focuses
    an open client or falls back to `openWindow("/")`.
  - `New Vitest project.` `public/push-sw.js` cannot be imported as a
    module from a test — Vite explicitly refuses to import a `.js` file
    living under `public/` into the module graph (even with `?raw`; only a
    non-JS/CSS asset or a `?url` reference is allowed there), and the "app"
    project (where a `?raw`-based guard test would otherwise run) is a real
    browser with no Node `fs` either. `vitest.config.ts` gained a small,
    dedicated `"public"` project (`environment: "node"`, `include:
    ["public/**/*.test.ts"]`), and `public/**` was added to "app"'s
    `exclude` so the same file is not picked up twice.

**Operational risk call: `message_notifications` growing unboundedly, with
no drain.** Real, and worth naming plainly rather than assuming it is
someone else's problem later. The fan-out trigger (session 1) queues a row
on every `messages` insert for every other participant, on every channel
that applies; nothing in this tree has ever claimed or settled one (the
Worker has never deployed). Two distinct consequences, not one:

1. **Storage growth.** Unbounded, but slow — this is a small
   matchmaking CRM's message volume, not a high-throughput system, so this
   alone is a "watch it, don't panic" risk, not an urgent one.
2. **The sharper risk: a delivery flood on first deploy.** The moment Epic
   12 gate G1 is discharged and the sweep starts running, it will find
   every `'pending'` row ever queued — potentially months of accumulated
   "you have a message" emails/pushes — and attempt to send them all in a
   burst, for messages long since read or irrelevant. That is a real,
   user-visible incident waiting in the queue today, not a hypothetical.

**Smallest mitigation** (a runbook step, not code — building `sweepMessages.ts`
is explicitly out of scope for this dispatch, and inventing a second drain
mechanism here would be exactly the "incompatible mechanism" failure this
project has hit before): **before the cron trigger is ever enabled for the
first time**, whoever discharges gate G1 should run one `update public.
message_notifications set status = 'skipped' where status = 'pending'`
against the accumulated backlog, so the sweep's first real tick starts
clean rather than blasting a historical backlog. This is a one-line,
one-time operational step — not a schema change, not a new function, and it
uses a `status` value (`'skipped'`) the schema already defines for exactly
"deliberately not sent." Longer-term, whichever story eventually builds
`sweepMessages.ts` should consider a retention policy (e.g. delete
`sent`/`skipped`/`failed` rows past some age) so the table does not grow
forever even once it IS being drained — named here as a follow-up, not
built.

### File List

**Schema / DB (owned)**
- `supabase/schemas/01_tables.sql` — `thread_participants.last_read_at`
  (tail-appended); `message_notifications`, `push_subscriptions` tables,
  FKs, the dedupe unique key, indexes.
- `supabase/schemas/02_functions.sql` — `fan_out_message_notifications()`,
  `mark_thread_read()`, `claim_message_notifications()`,
  `settle_message_notification()`, `delete_push_subscription_by_endpoint()`.
- `supabase/schemas/04_triggers.sql` — `fan_out_message_notifications_trigger`.
- `supabase/schemas/05_policies.sql` — RLS + FORCE on both new tables; the
  push_subscriptions `auth.uid()`-keyed policy.
- `supabase/schemas/06_grants.sql` — table/sequence/function grants for both
  new tables and all four new functions (including the `authenticated`
  TRUNCATE-revoke hardening fix above).
- `supabase/migrations/20260802051941_message_notifications.sql` — generated,
  then hand-fixed/hand-extended per the Debug Log / Completion Notes above
  (FORCE ROW LEVEL SECURITY, the three default-privilege revokes per table,
  all four function grants, and the ambiguous-`id` fix).
- `supabase/tests/message_notifications.sql` (new) — the DB assertion suite.
- `supabase/tests/message_notifications.test.ts` (new) — the suite runner
  plus AC-9's real two-session concurrency proof.
- `supabase/tests/migration-data-safety/fixture.sql` — seed + `capture()` for
  both new tables (guarded by `to_regclass`, matching the existing
  Epic-7 block's own reasoning).

**Workers (owned)**
- `workers/cron/webPush.ts` (new) — VAPID-signed, empty-payload Web Push send.
- `workers/cron/webPush.test.ts` (new).
- `workers/cron/index.ts` — `CronEnv` interface (VAPID keys), corrected
  header comment. `scheduled()` itself unchanged (blocked on Task 4/5).
- `workers/cron/wrangler.toml` — VAPID secrets added to the comment;
  `crons` schedule left untouched per the story's own instruction.

**Types (owned)**
- `src/components/atomic-crm/types.ts` — `MessageNotificationChannel`,
  `MessageNotificationStatus`, `PushSubscription`,
  `ThreadParticipant.last_read_at`.

**UI (owned, `threads/**`)** — session 1 unless noted
- `src/components/atomic-crm/threads/usePushSubscription.ts` (new).
- `src/components/atomic-crm/threads/usePushSubscription.test.tsx` (new).
- `src/components/atomic-crm/threads/computeUnreadThreadIds.ts` (new) — pure
  derived-unread predicate, extracted to its own file to satisfy
  `react-refresh/only-export-components`.
- `src/components/atomic-crm/threads/computeUnreadThreadIds.test.ts` (new).
- `src/components/atomic-crm/threads/ThreadList.tsx` — the unread indicator
  wiring (two extra `useGetList` reads, `ThreadRow`'s dot + `sr-only` label).
- `src/components/atomic-crm/threads/ThreadList.test.tsx` — three unread-
  indicator cases (session 1) **+ session 2's** open→mark-read→clears
  round-trip case, and the "decoy thread" fixture fix it forced (Gap 1).
- `src/components/atomic-crm/threads/ThreadPanel.tsx` (session 2) — the
  `markThreadRead()` `useEffect` (Gap 1).

**Providers (session 2, previously "not touched — out of scope")**
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` —
  `markThreadReadViaRpc` + its wiring into the returned provider (Gap 1).
- `src/components/atomic-crm/providers/fakerest/internal/threads.ts` —
  `markThreadRead()` mirror (Gap 1).
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — wires
  the mirror above into `markThreadRead` (Gap 1).
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` /
  `frenchCrmMessages.ts` — `crm.threads.panel.markReadError` (Gap 1) and
  `crm.settings.communication.push.*` (Gap 3).

**Settings (session 2, previously "not touched — out of scope")**
- `src/components/atomic-crm/settings/CommunicationSection.tsx` — Private
  radio re-enabled (Gap 2); `PushNotificationsItem` added, and the
  component restructured so the section container renders unconditionally
  (Gap 3).
- `src/components/atomic-crm/settings/CommunicationSection.test.tsx` —
  rebalanced for both gaps (F1's disabled-option test replaced with its
  enabled mirror; the three "renders nothing" tests now assert "the
  default-visibility control is absent, the push opt-in still renders").
- `src/components/atomic-crm/settings/CommunicationSection.endToEnd.test.tsx`
  (new, session 2) — Gap 2's real-dataProvider, click-to-created-thread
  proof.
- `src/components/atomic-crm/settings/CommunicationSection.push.test.tsx`
  (new, session 2) — Gap 3's four opt-in cases.

**PWA (session 2, previously "not touched — out of scope")**
- `public/push-sw.js` (new) — the `push`/`notificationclick` listeners
  (Gap 3).
- `public/push-sw.test.ts` (new) — Gap 3's service-worker proof.
- `vite.config.ts` — `workbox.importScripts: ["push-sw.js"]` (Gap 3).
- `vitest.config.ts` — new `"public"` Vitest project (Node environment) for
  `public/**/*.test.ts`; `public/**` added to the "app" project's `exclude`
  (Gap 3's "New Vitest project" note, above).

**Still not touched — deliberately, per this dispatch's brief (see "What
remains, and what unblocks it")**
`workers/shared/resend.ts` (+ test), `workers/cron/sweepMessages.ts`
(+ test), `workers/cron/index.ts`'s `scheduled()` body, `.env.example`.
