# Story 2.7: Invite-Only Signup with 18+ Affirmation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want new members to join only by a verified invite, with an affirmed age,
so that every connection into the product is consent-based and safe by construction —
never an open door.

## Dependencies

**Requires Story 2.6** (the OTP primitives this story's accept flow calls — this story
adds invite verification and 18+ affirmation *around* email-OTP, it does not build a
second signup mechanism). **Requires Story 2.1** (`current_context_id()` — `invites` is
RLS-scoped by it) and **Story 2.2** (`account_members_role_check` including `single`,
and `enforce_membership_role_matches_context()`, which the invite-acceptance binding
step relies on to keep a `shadchan`-role invite from ever landing on a household).
**Feeds Story 2.8**, which adds the inviter-side UI on top of the `invites` table and
`create_invite()` function this story builds.

## Scope boundary with Story 2.8 — read this first

This story builds the **mechanism** and the **invitee's** acceptance experience:
the `invites` table, `create_invite()` (the function; its calling UI is 2.8's),
`handle_new_user()`'s rewritten binding logic, the signup-gating Auth Hook, and
`login/InviteAcceptance.tsx` rewritten for OTP + the 18+ affirmation. Story 2.8 builds
the **inviter's** side: the Settings UI to send an invite, the invite list, and
`revoke_invite()`. Do not build an invite-sending UI here — there is nothing yet for a
real user to click that creates one (2.7's own tests seed invite rows directly in SQL);
that is 2.8's job.

## Decision — how the very first user, ever, gets in

Every invite in this design requires an `invited_by` — "an existing member," per the
epic's own AC text. That is correct for every household/shadchanus invite a real user
sends, but it leaves the founding case unaddressed: nobody exists yet to invite the very
first person. **Decision:** the platform owner seeds the first household and its first
invite directly via SQL against the production database (two `insert` statements — one
`accounts` row, one `invites` row with `invited_by = null`) — an operational runbook
action, not an in-app flow. `invites.invited_by` is nullable specifically to allow this
one seeded row; RLS on `invites` still requires `service_role` for any insert with
`invited_by is null` (AC-2), so the app itself never exposes a way to create one. This
keeps FR119 ("invites are the one mechanism for household membership") literally true —
even the founder's own membership arrives via an invite row, just one minted by hand
rather than by another member — while asking this story to build nothing beyond what
its own ACs call for. Flagged explicitly rather than silently assumed, since it is this
story's own resolution of a gap epics.md leaves open.

## Acceptance Criteria

1. **`public.invites` is the one table every invite — genesis or otherwise — lives in.**
   `id, token uuid not null default gen_random_uuid() unique, email text not null,
   account_id bigint not null references accounts(id) on delete cascade, role text not
   null check (role in ('parent_admin', 'helper', 'single', 'shadchan')), invited_by
   bigint references account_members(id) on delete set null, status text not null
   default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
   created_at timestamptz not null default now(), expires_at timestamptz not null
   default (now() + interval '14 days'), accepted_at timestamptz`. `self_manager` is
   deliberately **not** an invitable role (Dev Notes "Why `self_manager` is never
   invited").

2. **RLS: a context's own active members manage its own invites; nothing else can.**
   `using (account_id = current_context_id())` / `with check (account_id =
   current_context_id())` for `authenticated`. Rows with `invited_by is null` (the
   genesis seed, AC above) can only ever be inserted by `service_role` — there is no
   `authenticated` insert policy that permits a null `invited_by`, only
   `create_invite()` (Story 2.8's caller), which always sets it from the caller's own
   membership. A negative test: an authenticated client cannot `insert into invites
   (invited_by) values (null, …)` directly, bypassing `create_invite()`.

3. **`public.create_invite(p_email text, p_role text) returns public.invites` is the
   one function that creates an invitee-facing invite.** `SECURITY INVOKER` (it only
   ever targets the caller's own **active** context — unlike `add_persona()`, there is
   no "target a context I'm not currently in" case here, so the simpler security mode
   is correct, not a shortcut). Raises unless: the caller holds an **owning** role
   (`parent_admin`, `self_manager` or `shadchan`) in the active context — a `helper` or
   `single`-role member may never invite anyone; and `role_authority(p_role) <=
   role_authority(caller's own role)` (`public.role_authority()`, a small `IMMUTABLE`
   helper: `parent_admin = 3, self_manager = 2, helper = 1, single = 1, shadchan = 1`).
   This is the concrete shape of "role ≤ inviter authority" from the epic text. Sets
   `invited_by` from the caller's own `account_members.id`, never from a parameter.

4. **The invitee accepts by completing OTP signup with the invite's email — there is no
   separate password/acceptance form.** `login/InviteAcceptance.tsx` (rewritten from
   its current password-based shell): reached at `/accept-invite/:token`, it looks up
   the invite by token (a `get_invite_preview(p_token uuid)` `SECURITY DEFINER` function
   returning only `email`, `account_name`, `role`, `status`, `expires_at` — enough to
   render "You've been invited to join The Klein Family as a helper," never the
   inviting account's actual data), shows the AD-11 18+ affirmation checkbox
   (`login/AgeAffirmation.tsx`, already built as a UI shell — this story is its first
   real wiring), and — once both the invite is valid and the box is checked — calls
   Story 2.6's `login({ email: invite.email, requestOtp: true, meta: { invite_token,
   age_affirmed: true } })`, then the OTP-verify step. `email` is read-only, taken from
   the invite, never typed by the invitee.

5. **Signup is refused before an account is even created when there is no valid,
   unexpired, pending invite for the email — enforced in Postgres, not just hidden in
   the UI.** A Supabase **"before user created" Auth Hook**
   (`public.check_signup_invite(event jsonb) returns jsonb`, registered in
   `supabase/config.toml`'s `[auth.hook.before_user_created]`) rejects the signup
   attempt with a clear `403` unless `event`'s metadata carries a `token` matching a
   `pending`, unexpired `invites` row for that email, **and** the metadata's
   `age_affirmed` is `true`. Verify hook availability against the pinned Supabase
   CLI/GoTrue version before implementing; if the hook type is unavailable in this
   stack version, the fallback is documented in Dev Notes "If the Auth Hook is
   unavailable" — do not silently skip enforcement either way.

6. **`role` is never read from the request body — verified, not assumed.**
   `handle_new_user()`'s rewritten binding step (AC-7) resolves the granted role
   exclusively from `invites.role`, looked up server-side by the token in
   `raw_user_meta_data`. `grep -n "raw_user_meta_data.*role\|meta.*\.role" supabase/schemas/`
   returns no hit that feeds a role assignment.

7. **`handle_new_user()` drops the old bootstrap-first-user fallback and binds from the
   invite instead.** The `if not exists (select 1 from account_members) then … bootstrap
   …` branch (today's `02_functions.sql:269-282`) is deleted outright — not merely made
   conditional. In its place: look up the `pending`, unexpired `invites` row whose
   `token` matches `new.raw_user_meta_data->>'invite_token'`; if found, insert the
   `account_members` row with that invite's `account_id`/`role`/`invited_by` and mark
   the invite `accepted`; if not found (should not happen once AC-5's hook is live, but
   handled defensively), create **no** membership at all — the caller falls through to
   `current_context_id()`'s existing fail-closed NULL, exactly as an uninvited signup
   does today.

8. **`isInitialized`/`init_state` are deleted — the last piece of AD-1's "drop
   `init_state`" directive.** `SignupPage.tsx` and its `/sign-up` route are deleted
   (superseded entirely by `/accept-invite/:token` — there is no other signup entry
   point once invites gate everything); `providers/supabase/dataProvider.ts`'s
   `isInitialized()`, `authProvider.ts`'s `getIsInitialized`/`IS_INITIALIZED_CACHE_KEY`,
   and every `checkAuth`/`canAccess` branch that reads it are removed; the `init_state`
   view (`03_views.sql:130-135`) and its `anon`/`authenticated`/`service_role` grants
   are dropped from the schema.

9. **The genesis seed pattern actually works, proven by a test, not just described.**
   A new `supabase/tests/invites.sql` + `.test.ts`: (a) a `service_role`-inserted invite
   with `invited_by = null` succeeds, and the same insert attempted as `authenticated`
   fails (AC-2); (b) a matching signup (simulated by inserting into `auth.users` with
   the right `raw_user_meta_data`, mirroring `references_entity.sql`'s existing
   first-user test pattern) binds the correct `account_id`/`role` and flips the invite
   to `accepted`; (c) a signup with **no** matching invite creates zero `account_members`
   rows (AC-7's fallback case); (d) `create_invite()` refuses a `helper`/`single` caller
   (AC-3) and refuses granting a role above the caller's own authority.

10. **Toolchain green**: `make typecheck && npm run lint && make test &&
    npm run test:unit:db`.

## Tasks / Subtasks

- [ ] **Task 1 — `invites` table + RLS** (AC: 1, 2)
  - [ ] `01_tables.sql`: add `invites` per AC-1.
  - [ ] `05_policies.sql`: the account-scoped policy per AC-2, plus the explicit
        absence of an `authenticated`-role null-`invited_by` insert path (verify by
        writing the negative test in Task 6 before declaring this done, not after).
  - [ ] `06_grants.sql`: `grant all on table public.invites to service_role;
        grant select, insert, update on table public.invites to authenticated;` —
        `insert`/`update` are gated entirely by RLS's `with check`, not withheld at the
        grant level (consistent with every other domain table in this schema).

- [ ] **Task 2 — `role_authority()` + `create_invite()`** (AC: 3)
  - [ ] `02_functions.sql`: `role_authority(role text) returns int` (`IMMUTABLE`), then
        `create_invite()` per AC-3.
  - [ ] `06_grants.sql`: `execute` to `authenticated`, none to `anon`.

- [ ] **Task 3 — `get_invite_preview()`** (AC: 4)
  - [ ] `02_functions.sql`: `SECURITY DEFINER`, `STABLE`, returns only the four fields
        named in AC-4 — never the inviting account's own data, never the invite's
        `invited_by`/`id`. This is deliberately **anonymously readable** (it is how an
        unauthenticated invitee previews their invite before signing up), so grant
        `execute` to `anon` as well as `authenticated` — the one new anon-callable
        surface this story adds, and it is narrow by construction (AC-4's field list).

- [ ] **Task 4 — `handle_new_user()` rewrite** (AC: 6, 7)
  - [ ] `02_functions.sql`: delete the bootstrap branch, add the invite-lookup-and-bind
        branch per AC-7. Keep the `members` profile insert unchanged (that half is not
        this story's).
  - [ ] Add the 18+ affirmation check here as defense-in-depth (see Dev Notes "Two
        gates, one authoritative") **only if** AC-5's hook cannot itself block user
        creation in this Supabase version — do not build both as independent, divergent
        gates when one suffices.

- [ ] **Task 5 — The signup-gating Auth Hook** (AC: 5)
  - [ ] `02_functions.sql`: `check_signup_invite(event jsonb) returns jsonb` per AC-5.
  - [ ] `supabase/config.toml`: `[auth.hook.before_user_created]` registration.
  - [ ] `06_grants.sql`: grant `execute` to `supabase_auth_admin` (the role GoTrue hooks
        run as — confirm the exact role name against this Supabase version's hook
        documentation before granting; do not grant to `anon`/`authenticated`).

- [ ] **Task 6 — Delete `isInitialized`/`init_state`** (AC: 8)
  - [ ] `03_views.sql`: drop `init_state` and its comment block.
  - [ ] `06_grants.sql`: drop the three `init_state` grant lines.
  - [ ] `git rm login/SignupPage.tsx`; remove its two route registrations in
        `root/CRM.tsx` (desktop + mobile) and its import.
  - [ ] `providers/supabase/dataProvider.ts`: remove `isInitialized()` and `signUp()`
        (the latter is the old password-signup path — dead once `SignupPage.tsx` is
        gone; confirm no other caller before deleting).
  - [ ] `providers/supabase/authProvider.ts`: remove `getIsInitialized`,
        `IS_INITIALIZED_CACHE_KEY`, and the `checkAuth`/`canAccess` branches that call
        it. `checkAuth`'s remaining logic falls back to `baseAuthProvider.checkAuth`
        directly.
  - [ ] `providers/fakerest/dataProvider.ts`: remove the matching `isInitialized`
        emulation; confirm the FakeRest demo boot path (which never needed
        `isInitialized` to gate anything meaningful) still starts (AD-10).

- [ ] **Task 7 — `InviteAcceptance.tsx` rewrite** (AC: 4)
  - [ ] Rewrite per AC-4: fetch the preview via `get_invite_preview`, render
        `AgeAffirmation` (`compact` mode, per its existing prop), then Story 2.6's
        two-step OTP form with `email` locked to the invite's.
  - [ ] Register the `/accept-invite/:token` route in `root/CRM.tsx` in place of the
        deleted `/sign-up` route.
  - [ ] An expired or already-`accepted`/`revoked` invite renders a clear, specific
        message ("This invite has expired — ask [inviter] for a new one"), never a
        generic error.

- [ ] **Task 8 — Tests** (AC: 9)
  - [ ] `supabase/tests/invites.sql` + `.test.ts` per AC-9, following
        `references_entity.sql`'s existing "insert into `auth.users`, assert the
        trigger's effect" pattern for case (b) rather than inventing a new one.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Why the token — not just the email — drives the binding

`handle_new_user()` matches by a `token` carried in `raw_user_meta_data`, not by email
alone, specifically to stay correct when one email address holds more than one pending
invite (invited into two different households, or re-invited after an earlier invite
expired). The token arrives in metadata because Story 2.6's `signInWithOtp` call already
supports an `options.data` payload (used today for `first_name`/`last_name` in the old
password `signUp()` call) — `InviteAcceptance.tsx` threads `invite_token` and
`age_affirmed` through the same mechanism, not a new one.

### Two gates, one authoritative

AC-5's "before user created" hook and AC-7's `handle_new_user()` rewrite both *could*
enforce the invite/age-affirmation requirement, but only one should be the actual gate —
having both check independently risks them silently disagreeing over time. **The hook
is authoritative** (it runs first, and can outright refuse account creation with a
clear error the frontend can display before any row exists). `handle_new_user()` only
performs the *binding* once creation has already been allowed; Task 4's defensive
duplicate check is a fallback for the one scenario where the hook type turns out to be
unavailable in this Supabase version (Task 4/AC-5 both call this out explicitly so it is
not silently built twice as normal practice).

### If the Auth Hook is unavailable — verify before assuming either way

Supabase's "before user created" Postgres hook is a newer GoTrue capability; confirm it
exists for the pinned CLI/GoTrue version (`supabase/config.toml`'s CLI pin, cross-checked
against ARCHITECTURE-SPINE.md's Stack table) before building AC-5 as specified. If it is
genuinely unavailable: the fallback is `handle_new_user()` raising an exception when no
matching invite/affirmation is found, which rolls back the whole `auth.users` insert
transaction — a real, working data-level enforcement, just with a less friendly failure
mode (a raw Postgres error surfaces through GoTrue rather than a clean 403). Either way,
"signup without a valid invite is refused" must be provably true by Task 8's tests — the
tests do not change based on which mechanism enforces it.

### Why `self_manager` is never invited (AC-1)

`self_manager` means "a single who runs their own process, with no parent involved" — it
is a role a person arrives at through `add_persona('single')` finding no existing
household (Story 2.2's own logic), never a role a *second* person is invited into. An
invite that granted `self_manager` to an invitee would create a contradiction: a
household with an inviting `parent_admin` already present, and a "no parent involved"
role sitting inside it. Excluded from `invites.role`'s check constraint for this reason,
not by oversight.

### Verified current state

- `handle_new_user()` (`02_functions.sql:237-286`): the bootstrap branch this story
  deletes, with its own comment already flagging it as a placeholder ("Membership model
  here is deliberately minimal and invite-free … pending the real invite-token flow").
- `login/InviteAcceptance.tsx` (157 lines) and `login/AgeAffirmation.tsx` (119 lines):
  both explicitly self-documented as UI shells with "no backend wiring yet" — this
  story is that wiring, for both.
- `login/SignupPage.tsx` (238 lines), gated by `isInitialized` — deleted whole (AC-8).
- `03_views.sql:130-135` (`init_state`) and `06_grants.sql:119-121` (its three grants) —
  the last surviving pre-Epic-1 `security_invoker = off` definer view, explicitly
  flagged by AD-1 ("no definer views — drop `init_state`") and by 1.1/1.2's own Dev
  Notes as "Epic 2's to delete."
- `supabase/functions/users/index.ts:127-240` (`inviteUser`) — the fork's
  password-based admin-invite flow. **Out of scope for this story**: it is a distinct
  edge function serving the legacy `/members` admin UI, not the `invites` table this
  story builds. Flagged for whoever eventually retires it (nothing in Epic 2's stated
  scope asks for it, and Story 2.8 does not call it either).

### Security posture

New `SECURITY DEFINER` function (`get_invite_preview`, deliberately `anon`-callable —
the one new anon surface this story adds) and a new Auth Hook make this an unambiguous
`.claude/rules/security-triggers.md` case. Specifically verify: `get_invite_preview`
returns *only* the four named fields (never `invited_by`, `token` itself, or any
household data), and the Auth Hook function is not callable by `anon`/`authenticated`
directly (only by the GoTrue hook-invoking role).

### Testing standards

New `supabase/tests/invites.sql` + `.test.ts`, same shape as the existing suite files.
`.claude/rules/security-triggers.md`'s negative-test requirement covers AC-2 (the
`authenticated`-cannot-null-`invited_by` case) and AC-9 case (c) (no invite, no
membership).

### Project Structure Notes

Schema: `01_tables.sql`, `02_functions.sql`, `03_views.sql`, `05_policies.sql`,
`06_grants.sql`, `config.toml`. Frontend: `login/InviteAcceptance.tsx` (rewritten),
`login/AgeAffirmation.tsx` (wired, not rewritten), `root/CRM.tsx` (route swap),
`providers/{supabase,fakerest}/{dataProvider,authProvider}.ts`. Deleted:
`login/SignupPage.tsx`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.7] — the story's own AC
  text, verbatim.
- [Source: ARCHITECTURE-SPINE.md#AD-11] — "invite-token signup only … binds the row to
  the inviter's active context and authorizes `role ≤ inviter authority` … 18+
  affirmation … Invites are the one mechanism."
- [Source: ARCHITECTURE-SPINE.md#AD-1] — "no definer views (drop `init_state`)."
- [Source: _bmad-output/implementation-artifacts/1-1-delete-fossil-resources.md] /
  [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md] — both
  explicitly leave `init_state`/`is_admin()`/`isInitialized` untouched "for Epic 2."

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
