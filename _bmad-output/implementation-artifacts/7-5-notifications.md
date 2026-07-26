# Story 7.5: Notifications

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to know when someone writes to me on a thread I'm party to,
so that conversations move instead of going quiet in an app nobody thought to check
(FR100).

## Position in Epic 7

**5th of 5. Depends on 7.1–7.4** (the full thread model, including the connection
axis — a notification must fan out correctly regardless of which scope a message's
thread uses). This is the last story in the epic.

### Scope note — this is genuinely new infrastructure, not a gap in an existing one

Do not confuse this story with the reminders/tasks delivery mechanism referenced in
AD-13 and `workers/cron/index.ts`'s comment ("E7 (Reminders) lands here"). **That "E7"
is the old, pre-Amendment-A2 epic numbering** (reminders/tasks are already-built
Phase-1 functionality, not re-storied under the current `epics.md`). This story's
"Epic 7" is the new, post-A2 **Communication** epic — a different thing entirely. They
happen to share a delivery *mechanism* (in-app + email + push, no SMS) and this story
deliberately reuses what it can (the `workers/cron/` Worker, the
`"in_app"|"email"|"push"` channel vocabulary) — but as of this writing, **neither
reminders' nor anything else's actual email/push delivery is built yet**
(`workers/cron/index.ts`'s `scheduled()` handler is a `console.warn` stub; no Resend
*code* exists anywhere in the repo — though the `RESEND_API_KEY` secret plumbing
already does, in `workers/cron/wrangler.toml`'s comment and `.github/workflows/
deploy.yml` — and there is no push-subscription table and no VAPID key handling
at all). This story is the first to build real outbound delivery, and
whatever it builds becomes available for reminders to adopt later — that is a
beneficial side effect, not this story's job to guarantee.

## Acceptance Criteria

1. **In-app: unread state is derived, not queued.** `thread_participants` gains
   `last_read_at`. A thread is "unread" for a participant when
   `exists (select 1 from messages m where m.thread_id = tp.thread_id and
   m.created_at > coalesce(tp.last_read_at, '-infinity'))`. `public.mark_thread_read(
   p_thread_id bigint)` updates the caller's own `last_read_at` to `now()`.

2. **Email is the guaranteed floor.** Every new message queues exactly one
   `message_notifications` row per **other** thread participant with
   `channel = 'email'`; a background sweep sends it via Resend and marks it `sent`
   (or `failed`, with the error recorded, never silently dropped).

3. **Push is delivered only where installed.** A `channel = 'push'` row is queued for
   a recipient **only if** they have at least one row in the new
   `public.push_subscriptions` table; if they have none, no push row is queued and no
   error results — satisfying "by push where installed" without a dead-letter for
   users who never enabled it.

4. **No outbound SMS — structurally, not by omission.** `message_notifications.channel`
   is constrained to `('email', 'push')` only; there is no code path, table value, or
   Worker call anywhere in this story that can produce an SMS send.

5. **A message's sender is never notified about their own message.** The fan-out never
   queues a notification for `sender_member_id`.

6. **Delivery survives a burst without duplicate sends.** The sweep processes each
   `message_notifications` row exactly once (claims it — e.g. `status: 'pending' →
   'sending'` in the same statement that selects it — before dispatching), so two
   overlapping cron ticks cannot both email the same recipient for the same message.

7. **Verification — the toolchain is green**, plus the new
   `supabase/tests/message_notifications.sql` suite: the fan-out trigger queues the
   right rows for the right channels (including the "no subscription → no push row"
   case and the "sender excluded" case, AC-3/AC-5); `mark_thread_read()` only ever
   updates the caller's own participant row, never another's; and the mandatory
   negative test for `push_subscriptions` (a genuinely new RLS-guarded table this
   story introduces — `.claude/rules/security-triggers.md` applies): a second user's
   client cannot read, update or delete member A's push subscription row.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: read state and the delivery queue** (AC: 1, 2, 3, 4, 5)
  - [ ] `supabase/schemas/01_tables.sql`: `alter table public.thread_participants add
        column last_read_at timestamptz;` (nullable — unread by default, matching "a
        participant who never opened the thread has never read anything").
  - [ ] Add `public.message_notifications(id, account_id bigint, connection_id bigint,
        message_id bigint not null, recipient_member_id bigint not null, channel text
        not null, status text not null default 'pending', sent_at timestamptz, error
        text, created_at timestamptz not null default now())`. `channel` check
        `in ('email', 'push')` (AC-4 — structurally excludes SMS by never listing it as
        a legal value, the same closed-enumeration style as
        `is_child_visible_state`/`tasks_delivery_channels_check`). `status` check
        `in ('pending', 'sending', 'sent', 'failed')` (the `sending` state exists
        specifically for AC-6's claim-before-dispatch step).
  - [ ] Dual-axis scope on `message_notifications` (account_id/connection_id, XOR
        check), mirroring `messages`' own axis (a notification's scope always matches
        its message's) — reuse the Story 7.4 composite-FK pattern:
        `(account_id, message_id) references messages(account_id, id)` and
        `(connection_id, message_id) references messages(connection_id, id)`, both
        `on delete cascade`. **Prerequisite these FKs create:** `messages` has no
        composite unique keys yet (nothing referenced it in 7.1/7.4) — add
        `messages_account_id_id_key unique (account_id, id)` and
        `messages_connection_id_id_key unique (connection_id, id)` in the same
        migration.
  - [ ] `message_notifications.recipient_member_id` FK → `account_members(id) on
        delete cascade`; sweep index `message_notifications_pending_idx (status,
        created_at)` (the claim query filters `status='pending'` ordered by
        `created_at`).
  - [ ] Add `public.push_subscriptions(id, member_id bigint not null, endpoint text
        not null, p256dh text not null, auth text not null, created_at)`, unique
        `(member_id, endpoint)`, FK `member_id → account_members(id) on delete
        cascade`.

- [ ] **Task 2 — Fan-out trigger** (AC: 2, 3, 4, 5)
  - [ ] `supabase/schemas/02_functions.sql`: `fan_out_message_notifications()`
        (`after insert on messages`) — `SECURITY DEFINER SET search_path ''`. For each
        `thread_participants` row on `new.thread_id` where `member_id is distinct
        from new.sender_member_id` (**`is distinct from`, not `<>`** —
        `sender_member_id` is nullable per 7.1's `on delete set null`, and
        `member_id <> NULL` is never true, which would silently queue *nothing* for
        any message whose sender member was deleted): insert one
        `message_notifications` row with `channel = 'email'` unconditionally (AC-2);
        insert a second row with `channel = 'push'` **only if** `exists (select 1
        from push_subscriptions where member_id = <that participant>)` (AC-3). Copy
        `account_id`/`connection_id` from `new` (whichever is non-null) onto every
        inserted row.
  - [ ] `04_triggers.sql`: wire it `after insert on messages`.

- [ ] **Task 3 — `mark_thread_read()` and RLS/grants** (AC: 1, 7)
  - [ ] `public.mark_thread_read(p_thread_id bigint) returns public.thread_participants`
        — `SECURITY DEFINER SET search_path ''`: `update thread_participants tp set
        last_read_at = now() where tp.member_id = public.current_member_id() and
        tp.thread_id = p_thread_id returning tp.*`. The `current_member_id()`
        predicate (Epic 3 Story 3.5's resolver, same as the rest of Epic 7) is the
        entire authorization check — it can only ever touch the participant row of
        the caller's own membership in their active context, by construction (a
        caller with no matching `thread_participants` row simply updates zero rows).
  - [ ] `message_notifications` and `push_subscriptions`: `enable row level security`
        + `force row level security`. `message_notifications` gets **no policy for
        `authenticated` at all** (it's a pure backend delivery queue — the fan-out
        trigger and the cron worker are the only writers/readers, both effectively
        `service_role`/definer-privileged; a client has no legitimate reason to read
        or write it). `push_subscriptions` gets `for all to authenticated using
        (exists (select 1 from account_members am where am.id =
        push_subscriptions.member_id and am.user_id = auth.uid()))` `with check`
        (same expression) — a user manages
        only their own subscriptions, across whichever of their own `account_members`
        rows, regardless of which context is currently active (registering a device
        for push isn't a tenant-data read; deliberately `auth.uid()`, not
        `current_member_id()`, for exactly that reason).
  - [ ] `06_grants.sql`: revoke `anon` on both new tables; grant `select, insert,
        delete` on `push_subscriptions` to `authenticated` (no update — replace via
        delete+insert, simpler); grant `all` on both to `service_role`. Sequences:
        `push_subscriptions_id_seq` revoke `anon`, grant `authenticated` +
        `service_role`; `message_notifications_id_seq` revoke `anon`, grant
        `service_role` only (no `authenticated` write path exists). Function grants:
        `mark_thread_read` to `authenticated`/`service_role` (revoke `public`,
        `anon`); the fan-out trigger function needs no direct grant, only the table
        trigger wired to it.

- [ ] **Task 3a — Generate and apply the migration** (AC: 1, 2, 3)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        message_notifications`. Hand-check: confirm `FORCE ROW LEVEL SECURITY` is
        emitted for both `message_notifications` and `push_subscriptions`, and confirm
        the dual-axis composite FKs on `message_notifications` are both present (same
        risk as Story 7.4's Task 4b — `db diff` under-emitting a second multi-column
        FK).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset`, never `db push`.

- [ ] **Task 4 — Outbound email via Resend** (AC: 2, 6)
  - [ ] New file `workers/shared/resend.ts`: a minimal `sendEmail({ to, subject,
        html })` wrapper around `POST https://api.resend.com/emails` using the
        `RESEND_API_KEY` secret — the secret plumbing already exists (listed in
        `workers/cron/wrangler.toml`'s secrets comment; pushed to the cron Worker by
        `.github/workflows/deploy.yml`); only the code is missing. Never in the
        client bundle — matches the
        existing "Security (Workers)" convention. Kept in `shared/` since outbound
        email is a cross-cutting capability other Workers may need later — this story
        is its first and only consumer today (YAGNI: no other caller is added).
  - [ ] The claim step lives in Postgres: add
        `public.claim_message_notifications(p_limit int) returns setof
        public.message_notifications` — the claim-then-dispatch CTE from Dev Notes
        (`for update skip locked`, which PostgREST cannot express as a plain query) —
        with execute granted to `service_role` **only**. The Worker calls it via
        `.rpc()` on the service-role `@supabase/supabase-js` client (the client the
        Workers already use — there is no `pg` driver in this repo, and a raw
        Postgres connection from a Worker would be a new dependency this story does
        not need).
  - [ ] New file `workers/cron/notifyMessages.ts`: the sweep. Calls
        `claim_message_notifications()`; for `channel = 'email'`, resolve the
        recipient's email — `account_members.user_id`, then
        `client.auth.admin.getUserById()` on the service-role client (the `auth`
        schema is **not** exposed through PostgREST, so a join to `auth.users` is not
        available to supabase-js) — and the thread's subject for a subject line, call
        `sendEmail()`, then set `status = 'sent', sent_at = now()` or `status =
        'failed', error = …` on failure. Uses the service-role client directly
        (**not** `forAccount()`): the sweep is genuinely cross-tenant system work,
        the cron-Worker exemption AD-7 anticipates — `workers/cron/wrangler.toml`
        already provisions `SUPABASE_SERVICE_ROLE_KEY` for exactly this.
  - [ ] `workers/cron/index.ts`: replace the `console.warn` stub in `scheduled()` with
        a call to the new module (`await notifyMessages(env)`); leave the reminders
        sweep as a TODO exactly as it is today — this story does not implement it.
        Tighten the **existing** `[triggers]` schedule in `workers/cron/wrangler.toml`
        (today `crons = ["*/15 * * * *"]`, a provisional value) to `*/1 * * * *` — a
        "you have a new message" email up to 15 minutes late is not timely; document
        the cost tradeoff in the existing comment. This is a decision this story
        makes, not leaves open.

- [ ] **Task 5 — Push delivery** (AC: 3, 6)
  - [ ] New file `workers/cron/webPush.ts`: sends a Web Push message (RFC 8291/8292)
        to a `push_subscriptions` row using VAPID. **Cloudflare Workers do not support
        Node's `crypto` module that the `web-push` npm package depends on** — do not
        add it as a dependency without first verifying compatibility under this
        project's `nodejs_compat` flag; if it doesn't work, implement VAPID JWT signing
        (ES256) directly with the Web Crypto API (`crypto.subtle.importKey` /
        `crypto.subtle.sign`), which Workers fully support. `VAPID_PUBLIC_KEY` /
        `VAPID_PRIVATE_KEY` as Wrangler secrets (never in the client bundle beyond the
        public key, which the client needs to subscribe).
  - [ ] For `channel = 'push'` rows the sweep claims: call `webPush.send()` for each of
        the recipient's `push_subscriptions` rows; mark `sent`/`failed` accordingly. A
        `410 Gone`/`404` response from the push service means the subscription is
        dead — delete the `push_subscriptions` row so future messages stop trying it
        (self-healing, avoids an ever-growing dead-subscription list).

- [ ] **Task 6 — Client: subscribing to push** (AC: 3)
  - [ ] New hook `src/components/atomic-crm/threads/usePushSubscription.ts`: on
        explicit user opt-in (a button, not auto-run on every page load — permission
        prompts that fire unprompted are bad UX and this repo's PWA scaffold
        (`vite-plugin-pwa`) doesn't do this today), calls
        `Notification.requestPermission()`, then `navigator.serviceWorker.ready` →
        `registration.pushManager.subscribe({ userVisibleOnly: true,
        applicationServerKey: VITE_VAPID_PUBLIC_KEY })`, then
        `dataProvider.create("push_subscriptions", { endpoint, p256dh, auth })`
        extracted from the subscription object.
  - [ ] Surface the opt-in from `settings/CommunicationSection.tsx` (added by Story
        7.2) — a natural home next to the default-thread-visibility control, avoiding
        a third settings section for one toggle.

- [ ] **Task 7 — In-app unread UI** (AC: 1)
  - [ ] `threads/ThreadPanel.tsx` / `ThreadList.tsx` (from 7.1): call
        `mark_thread_read()` when a thread is opened; show an unread indicator per
        thread (per AC-1's derived definition) and, if a global surface exists by this
        point (e.g. a nav badge), a total-unread count — scope this to what's
        practically reachable; a dedicated notification bell/center is not requested
        by any Epic 7 AC and is out of scope (YAGNI).

- [ ] **Task 8 — Types and provider** (AC: 1, 2, 3)
  - [ ] `types.ts`: `MessageNotificationChannel = "email" | "push"` (mirrors the
        existing `TaskDeliveryChannel` in the same file — **do not** rename or
        refactor `TaskDeliveryChannel` itself to be shared; that is a cross-epic
        cleanup for the epic owner to schedule deliberately, not a silent side effect
        here — see Dev Notes), `PushSubscription` type, `last_read_at?: string |
        null;` on `ThreadParticipant`.
  - [ ] `providers/supabase/dataProvider.ts`: `markThreadRead(threadId)` RPC wrapper.
  - [ ] Mirror in `providers/fakerest/` — the fakerest emulation of `mark_thread_read`
        and a no-op/logged fakerest "delivery" (FakeRest has no real backend to run a
        cron sweep against; document that push/email delivery is inherently
        untestable in the FakeRest demo build and that's expected, not a gap).

- [ ] **Task 9 — Tests** (AC: 7)
  - [ ] New `supabase/tests/message_notifications.sql` + `.test.ts` (separate file
        from `threads_entity.sql` — a distinct concern, delivery rather than the
        thread model itself, keeping both files under the ~400-line typical ceiling
        per `.claude/rules/coding-style.md`). Cover: fan-out queues one `email` row
        per other participant; a participant with a `push_subscriptions` row also
        gets a `push` row, one without does not (AC-3); the sender is never queued
        (AC-5); `mark_thread_read()` only touches the caller's own row; an
        authenticated client reads **zero** `message_notifications` rows (the
        no-policy posture, asserted rather than assumed); and the negative test — a
        second user's client reads/updates/deletes zero rows of another user's
        `push_subscriptions`.
  - [ ] `workers/cron/notifyMessages.test.ts` / `workers/cron/webPush.test.ts` /
        `workers/shared/resend.test.ts`:
        mock the Resend/Web-Push HTTP calls, assert claim-then-dispatch ordering
        (AC-6) and status transitions on success/failure.
  - [ ] Vitest for `usePushSubscription`/the settings opt-in/the unread indicator
        (AAA, ≥80% new lines).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        prettier on this story's changed files only.

## Dev Notes

### Why in-app delivery needs no queue

Modelling "in-app" as a `message_notifications` row (like email/push) would require an
async delivery step for something that's really just a **read/unread comparison** —
the message already exists the moment it's inserted; "in-app delivery" is nothing more
than the UI showing it's unread until the participant opens the thread. Deriving it
from `thread_participants.last_read_at` vs `messages.created_at` needs no background
job, no failure mode, and can't drift from reality the way a queued-and-forgotten
in-app row could. This mirrors how reminders' "in-app" delivery is just the reminder
existing and appearing in the Reminders list — not a separate notification record
either.

### Do not refactor `TaskDeliveryChannel`

`src/components/atomic-crm/types.ts` already defines `TaskDeliveryChannel = "in_app" |
"email" | "push"` (consumed by the reminders feature, e.g.
`reminders/ReminderCreateSheet.tsx`). This story's
`MessageNotificationChannel = "email" | "push"` intentionally uses the identical two
literal values for consistency, but is its own type — reminders and Epic 7 messaging
are different features that happen to share a delivery vocabulary today. Unifying them
into one shared `DeliveryChannel` type is a reasonable idea but is a deliberate,
scheduled cross-epic refactor, not something to fold into this story unasked (it would
change a type an already-built feature depends on, with its own review surface).

### The claim-then-dispatch pattern (AC-6)

```sql
with claimed as (
  update public.message_notifications
  set status = 'sending'
  where id in (
    select id from public.message_notifications
    where status = 'pending'
    order by created_at
    limit 100
    for update skip locked
  )
  returning *
)
select * from claimed;
```
`FOR UPDATE SKIP LOCKED` is what makes this safe if the Worker's `scheduled()` handler
ever overlaps itself (a slow previous run still executing when the next cron tick
fires) — the second invocation simply skips rows the first has already locked, rather
than double-sending. It ships as the `claim_message_notifications(p_limit)` function
(Task 4) because PostgREST cannot express `FOR UPDATE SKIP LOCKED`; the Worker reaches
it via `.rpc()` on the service-role supabase-js client — `message_notifications` has
no `authenticated` policy at all, and the function's execute grant is `service_role`
only.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-22] — "Delivery is in-app + email + push; no
  outbound SMS, ever (AD-13)."
- [Source: ARCHITECTURE-SPINE.md#AD-13] — the in-app+email+push, no-SMS delivery model
  this story's channel vocabulary and worker placement deliberately mirror (a
  different, already-built feature — see "Scope note" above for why this is not the
  same Epic 7).
- [Source: ARCHITECTURE-SPINE.md#AD-7] — Worker compute home; `forAccount()` exemption
  for genuinely cross-tenant system work (the sweep).
- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.5-Notifications]
- `workers/cron/index.ts` (current stub, replaced by Task 4) and
  `workers/cron/wrangler.toml` (existing `*/15` schedule + secrets comment).
- `src/components/atomic-crm/types.ts` (`TaskDeliveryChannel`, near `Task` — the
  vocabulary this story mirrors but does not refactor).
- `supabase/schemas/01_tables.sql:119-140` (`tasks.delivery_channels` — the closed
  channel-enumeration precedent `message_notifications.channel`'s check constraint
  follows).
- `supabase/schemas/05_policies.sql:251-268` (`subscription`/`ai_usage` — the
  "no policy for `authenticated`" precedent `message_notifications` follows more
  strictly still, since even SELECT is withheld).
- Story `7-4-any-pairing-private-thread.md` — the dual-axis composite-FK pattern this
  story reuses verbatim for `message_notifications`.

### Project Structure Notes

- New backend files: `workers/shared/resend.ts`, `workers/cron/notifyMessages.ts`,
  `workers/cron/webPush.ts` (each under the typical 200-400 line ceiling — three files
  rather than one large `notifyMessages.ts`, per "grow the file count").
- New frontend file: `threads/usePushSubscription.ts`.
- No new top-level resource directory — `message_notifications`/`push_subscriptions`
  are backend-only/self-service tables, not react-admin resources with their own list
  pages.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
