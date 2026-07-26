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
`login/InviteAcceptance.tsx` rewritten for OTP + the 18+ affirmation. It also retires
`is_admin()` (AC-9) — the sibling of `isInitialized` in AD-2's directive, deleted in
the same story because both are the fork's "first user is special" world ending at
once. Story 2.8 builds the **inviter's** side: the Settings UI to send an invite, the
invite list, and `revoke_invite()` — and deletes the fork's parallel admin-invite
path. Do not build an invite-sending UI here — there is nothing yet for a real user to
click that creates one (2.7's own tests seed invite rows directly in SQL); that is
2.8's job.

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

2. **RLS: a context's own active members see its own invites; nothing writes the table
   except this story's functions and `service_role`.** One **select-only** policy for
   `authenticated`: `using (account_id = current_context_id())`. There is **no**
   insert/update/delete policy and **no** DML grant to `authenticated` at all — every
   write goes through `create_invite()` (AC-3), `revoke_invite()` (Story 2.8),
   `handle_new_user()`'s binding step (AC-7, a definer trigger), or the `service_role`
   genesis seed. This is deliberate, not a shortcut: if `authenticated` could insert
   with only an account-match `with check`, all of AC-3's authority/kind checks would
   be advisory — any active member, including a `helper`, could PostgREST-insert an
   invite row with `role = 'parent_admin'` and a hand-picked `invited_by`, read the
   token back through the select policy, and mint themselves (or anyone) an admin
   membership. The authority boundary must hold at the grant, not just inside the
   function. Negative tests: a direct `insert` into `invites` as `authenticated` is
   refused (both with and without `invited_by`), and a direct `update` (e.g. flipping
   `status` or `role`) is refused likewise; the `invited_by is null` genesis insert
   succeeds only as `service_role`.

3. **`public.create_invite(p_email text, p_role text) returns public.invites` is the
   one function that creates an invitee-facing invite.** `SECURITY DEFINER`,
   `SET search_path = ''` (the `handle_new_user()` precedent): AC-2 withholds every
   DML grant on `invites` from `authenticated`, so an invoker-rights insert would be
   refused at the grant before its own checks ever ran — the definer mode is the
   consequence of closing the direct-write escalation, and the function's own explicit
   checks are therefore the *only* write gate and must all be present. It starts with
   an explicit active-membership check on `current_context_id()`
   (`exists (select 1 from public.account_members am where am.account_id =
   current_context_id() and am.user_id = auth.uid() and am.status = 'active')`), then
   raises unless: the caller holds an **owning** role
   (`parent_admin`, `self_manager` or `shadchan`) in the active context — a `helper` or
   `single`-role member may never invite anyone; and `role_authority(p_role) <=
   role_authority(caller's own role)` (`public.role_authority()`, a small `IMMUTABLE`
   helper: `parent_admin = 3, self_manager = 2, helper = 1, single = 1, shadchan = 1`).
   This is the concrete shape of "role ≤ inviter authority" from the epic text. **It
   also raises on a role/context-kind mismatch**: on a `household`-kind active context,
   `p_role` must be in (`parent_admin`, `helper`, `single`); on a `shadchanus`-kind
   one, `p_role` must be `shadchan`. Without this check, a shadchan could mint a
   `helper` invite (authority 1 ≤ 1 passes) that 2.2's
   `enforce_membership_role_matches_context()` trigger then rejects at acceptance —
   an invite that can never succeed must be refused at creation, not discovered broken
   by the invitee. Note this invite-capable list (`parent_admin`, `self_manager`,
   `shadchan`) is deliberately **broader** than 2.2's owning-role helper
   (`parent_admin`, `self_manager`) — a shadchan can invite into their shadchanus but
   never owns a `singles` row; do not merge the two predicates. Sets
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
   Story 2.6's `login({ email: invite.email, requestOtp: true, allowSignup: true,
   meta: { invite_token, age_affirmed: true } })` — `allowSignup`/`meta` are the seam
   2.6 AC-2 built for exactly this call, and this flow is the **only** caller in the
   product that passes `allowSignup: true` (2.6's login page hard-defaults
   `shouldCreateUser` to false) — then the OTP-verify step. `email` is read-only, taken
   from the invite, never typed by the invitee.

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

9. **`is_admin()` is retired — the other half of AD-2's "retire
   `is_admin()`/`isInitialized`" directive, deferred to Epic 2 by name by story 1.2
   ("retiring `is_admin()` itself is AD-1 / Epic 2, not this story").** The SQL
   function `public.is_admin()` is deleted with its grant lines, and the two
   `configuration` policies that call it (`Enable insert for admins`, `Enable update
   for admins`) are dropped **without replacement** — the `configuration` singleton
   (branding/config jsonb) becomes read-only to `authenticated` (its existing
   `using (true)` read policy is unchanged) and writable only by `service_role`, a
   platform-ops runbook action exactly like this story's genesis seed. This is safe to
   do bluntly because the write path is already dead in the app:
   `dataProvider.updateConfiguration()` has **zero** UI callers (verified — only
   `getConfiguration()` is called, from `root/CRM.tsx` and
   `root/useConfigurationLoader.ts`), so `updateConfiguration` is deleted from both
   providers along with the `resource: "configuration"` entry in the supabase
   provider's `lifeCycleCallbacks`. The frontend's admin special-casing of
   `configuration` goes with it: the `params.resource === "configuration"` branch in
   `providers/commons/canAccess.ts` is removed, as are the two
   `<CanAccess resource="configuration" action="edit">` wrappers (around the Settings
   nav item in `layout/Sidebar.tsx` and the Settings menu item in `layout/TopBar.tsx`)
   — Settings is a per-member surface (Personas 2.5, Invites 2.8), and the mobile
   bottom nav already exposes it ungated, so the admin gate was both wrong and
   inconsistent. **Kept, deliberately:** the `members.administrator` column, the
   `"admin"`-role mapping in `authProvider.canAccess`, and the members-resource
   gating — they feed the fork's user-management list, whose replacement is Epic 3/6's
   `useViewerRole` work, not this story's. After this story:
   `select to_regproc('public.is_admin')` returns NULL, and
   `grep -rn "is_admin" supabase/schemas/ src/` returns zero hits.

10. **The genesis seed pattern actually works, proven by a test, not just described.**
   A new `supabase/tests/invites.sql` + `.test.ts`: (a) a `service_role`-inserted invite
   with `invited_by = null` succeeds, and **any** direct `insert` or `update` on
   `invites` as `authenticated` fails — including a `helper`'s hand-crafted
   `role = 'parent_admin'` insert with a non-null `invited_by` (AC-2's escalation
   case); (b) a matching signup (simulated by inserting into `auth.users` with
   the right `raw_user_meta_data`, mirroring `references_entity.sql`'s existing
   first-user test pattern) binds the correct `account_id`/`role` and flips the invite
   to `accepted`; (c) a signup with **no** matching invite creates zero `account_members`
   rows (AC-7's fallback case); (d) `create_invite()` refuses a `helper`/`single`
   caller (AC-3), refuses granting a role above the caller's own authority, and
   refuses a role/context-kind mismatch (a `shadchan`-role invite from a household
   context; a non-`shadchan`-role invite from a shadchanus context).

11. **Toolchain green**: `make typecheck && npm run lint && make test &&
    npm run test:unit:db`.

## Tasks / Subtasks

- [ ] **Task 1 — `invites` table + RLS** (AC: 1, 2)
  - [ ] `01_tables.sql`: add `invites` per AC-1.
  - [ ] `05_policies.sql`: `enable row level security` + `force row level security`;
        the **select-only** account-scoped policy per AC-2 — deliberately no
        insert/update/delete policy for `authenticated` (verify by writing the
        negative tests in Task 9 before declaring this done, not after).
  - [ ] `06_grants.sql`: `revoke all on table public.invites from anon;
        grant select on table public.invites to authenticated;
        grant all on table public.invites to service_role;` — DML is withheld at the
        grant level (AC-2's rationale); the sequence `invites_id_seq` gets no
        `authenticated` grant either, since `authenticated` never inserts directly.

- [ ] **Task 2 — `role_authority()` + `create_invite()`** (AC: 3)
  - [ ] `02_functions.sql`: `role_authority(role text) returns int` (`IMMUTABLE`), then
        `create_invite()` per AC-3.
  - [ ] `06_grants.sql`: `revoke all on function … from public, anon;` for both,
        then `execute` to `authenticated` (the file's standard revoke-then-grant
        pattern — PUBLIC gets EXECUTE by default otherwise).

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
  - [ ] `06_grants.sql`: `revoke all on function public.check_signup_invite(jsonb)
        from public, anon, authenticated;` then grant `execute` to
        `supabase_auth_admin` (the role GoTrue hooks run as — confirm the exact role
        name against this Supabase version's hook documentation before granting).

- [ ] **Task 6 — Delete `isInitialized`/`init_state`** (AC: 8)
  - [ ] `03_views.sql`: drop `init_state` and its comment block.
  - [ ] `06_grants.sql`: drop the three `init_state` grant lines.
  - [ ] `git rm login/SignupPage.tsx`; remove its two route registrations in
        `root/CRM.tsx` (desktop + mobile) and its import.
  - [ ] `git rm login/StartPage.tsx` — its whole purpose is the `isInitialized` branch
        (route to `/sign-up` for an uninitialized install), which no longer exists.
        Change `root/CRM.tsx`'s `loginPage={StartPage}` (line 230 today) to
        `loginPage={LoginPage}` and drop the import.
  - [ ] `git rm login/ConfirmationRequired.tsx` and its two route registrations in
        `root/CRM.tsx` (253-254 and 330-331 today): its only navigator was
        `SignupPage.tsx`'s email-confirmation redirect, and the OTP flow has no
        confirmation-link step — the typed-back code is the confirmation.
  - [ ] Remove `authProvider.ts`'s `#/sign-up` `checkAuth` special-case (line 143
        today) — the sibling `/set-password`/`/forgot-password` cases went with 2.6.
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

- [ ] **Task 7 — Retire `is_admin()` and the `configuration` write path** (AC: 9)
  - [ ] `02_functions.sql`: delete `is_admin()` (header at line 316 today).
        `05_policies.sql`: drop `Enable insert for admins` / `Enable update for
        admins` on `public.configuration`; keep `Enable read for authenticated`.
        `06_grants.sql`: delete `is_admin()`'s grant lines; leave `configuration`'s
        table grants alone (writes are stopped by the absence of any
        insert/update policy, and `service_role` bypasses RLS).
  - [ ] `providers/supabase/dataProvider.ts`: delete `updateConfiguration()` and the
        `resource: "configuration"` lifecycle-callback block;
        `providers/fakerest/dataProvider.ts`: delete its `updateConfiguration`
        emulation. Keep `getConfiguration()` in both.
  - [ ] `providers/commons/canAccess.ts`: remove the `configuration` branch.
        `layout/Sidebar.tsx` (`SidebarNavItem`) and `layout/TopBar.tsx`
        (`SettingsMenuItem`): unwrap the two `<CanAccess resource="configuration"
        action="edit">` wrappers so the Settings entry points render for every member.
  - [ ] Run AC-9's `to_regproc` check and grep; both must come back empty.

- [ ] **Task 8 — `InviteAcceptance.tsx` rewrite** (AC: 4)
  - [ ] Rewrite per AC-4: fetch the preview via `get_invite_preview`, render
        `AgeAffirmation` (`compact` mode, per its existing prop), then Story 2.6's
        two-step OTP form with `email` locked to the invite's.
  - [ ] Register the `/accept-invite/:token` route in `root/CRM.tsx` in place of the
        deleted `/sign-up` route.
  - [ ] An expired or already-`accepted`/`revoked` invite renders a clear, specific
        message ("This invite has expired — ask [inviter] for a new one"), never a
        generic error.

- [ ] **Task 9 — Tests** (AC: 10)
  - [ ] `supabase/tests/invites.sql` + `.test.ts` per AC-10, following
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
"signup without a valid invite is refused" must be provably true by Task 9's tests — the
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
  deletes, with its own header comment already flagging it as a placeholder
  ("Membership model here is deliberately minimal and invite-free (AD-11's full invite
  binding is Epic-1) … see nothing until the invite flow grants them one" —
  02_functions.sql:227-236; the "Epic-1" in that comment is stale pre-renumbering
  text, the invite flow is this story).
- `login/InviteAcceptance.tsx` (157 lines) and `login/AgeAffirmation.tsx` (119 lines):
  both explicitly self-documented as UI shells with "no backend wiring yet" — this
  story is that wiring, for both.
- `login/SignupPage.tsx` (238 lines), gated by `isInitialized` — deleted whole (AC-8).
- `03_views.sql:130-135` (`init_state`) and `06_grants.sql:119-121` (its three grants) —
  the last surviving pre-Epic-1 `security_invoker = off` definer view, explicitly
  flagged by AD-1 ("no definer views — drop `init_state`") and by 1.1/1.2's own Dev
  Notes as "Epic 2's to delete."
- `supabase/functions/users/index.ts:127-240` (`inviteUser`) — the fork's
  password-based admin-invite flow (`auth.admin.inviteUserByEmail` → the deleted
  set-password page). **Out of scope for this story, retired by Story 2.8** (whose
  epic title — invites as the *one* membership mechanism — is exactly the rule it
  violates). Note it is doubly dead after this story anyway: its emailed link lands on
  a route 2.6 deleted, and its user creation is refused by AC-5's hook (no
  `invite_token` in metadata) — 2.8 deletes the corpse.

### Security posture

Two new `SECURITY DEFINER` functions (`get_invite_preview`, deliberately
`anon`-callable — the one new anon surface this story adds — and `create_invite`,
the sole authenticated write path onto a table with no client DML grant) and a new
Auth Hook make this an unambiguous `.claude/rules/security-triggers.md` case.
Specifically verify: `get_invite_preview` returns *only* the four named fields (never
`invited_by`, `token` itself, or any household data); `create_invite` performs every
check in AC-3 itself (as a definer function it is the entire write gate — RLS no
longer backstops it); and the Auth Hook function is not callable by
`anon`/`authenticated` directly (only by the GoTrue hook-invoking role).

### Testing standards

New `supabase/tests/invites.sql` + `.test.ts`, same shape as the existing suite files.
`.claude/rules/security-triggers.md`'s negative-test requirement covers AC-2 (the
`authenticated`-cannot-null-`invited_by` case) and AC-10 case (c) (no invite, no
membership).

### Project Structure Notes

Schema: `01_tables.sql`, `02_functions.sql`, `03_views.sql`, `05_policies.sql`,
`06_grants.sql`, `config.toml`. Frontend: `login/InviteAcceptance.tsx` (rewritten),
`login/AgeAffirmation.tsx` (wired, not rewritten), `root/CRM.tsx` (route swap +
`loginPage` swap), `providers/{supabase,fakerest}/{dataProvider,authProvider}.ts`,
`providers/commons/canAccess.ts`, `layout/Sidebar.tsx`, `layout/TopBar.tsx` (AC-9's
unwraps). Deleted: `login/SignupPage.tsx`, `login/StartPage.tsx`,
`login/ConfirmationRequired.tsx`.

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
