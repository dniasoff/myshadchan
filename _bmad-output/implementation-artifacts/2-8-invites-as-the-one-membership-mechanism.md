# Story 2.8: Invites as the One Membership Mechanism

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want one way to bring in my spouse, a helper, or my single,
so that membership is predictable — one screen, one mechanism, regardless of who I am
adding.

## Dependencies

**Requires Story 2.7 (hard).** This story is the **inviter-side** UI and the revoke
path on top of the `invites` table, `create_invite()`, and the OTP-based acceptance flow
2.7 already built. It adds no new provisioning or acceptance logic of its own.
**Requires Story 2.7's helpers** (`role_authority()` and the invite-capable-role
check live there) and **Story 2.2** (whose narrower owning-role helper is a different
predicate — see 2.7 AC-3's note; reuse each, re-derive neither).

## Scope boundary — what this story does not build

**The parent↔shadchan connection** (epics.md's own third bullet for this story) is
**not** built here. A connection is a distinct third scope (`connections`, AD-20), not
an `account_members` row — inviting a shadchan into a household as a *member* is
structurally forbidden by Story 2.2's own
`enforce_membership_role_matches_context()` trigger (`shadchan` role may only exist on
a `shadchanus`-kind account, never a `household`-kind one). epics.md names Epic 8 for
this bullet (the connection flows are its Story 8.2; the `connections` table itself is
introduced earlier, by Epic 7's Story 7.4, per that story's own header) — what this
story delivers is the **pattern** those stories extend: a token-based,
consent-required, revocable-before-acceptance invite row. Flagged here explicitly as
**epics.md's own forward dependency onto Epics 7/8**, not invented or pre-built in
this story.

## Acceptance Criteria

1. **One screen sends every kind of household invite.** New `settings/InvitesSection.tsx`
   (alongside `FamilySection`/the new `PersonasSection` from Story 2.5): an email field
   and a role selector, calling `dataProvider.createInvite(email, role)` →
   `create_invite()` (Story 2.7). The role selector's options are computed client-side
   from the caller's own role via the **same** `role_authority()` ordering Story 2.7's
   function enforces server-side (client-side is UX only — `create_invite()`'s own
   check is the actual enforcement; the client list exists so a `helper` viewing the
   form sees no invitable options at all rather than an error after submitting).

2. **The invite link is shareable, not auto-emailed — a deliberate Phase-1 scope call.**
   On success, the screen shows `${origin}/#/accept-invite/${token}` with a copy button.
   No outbound email is sent by this story. **Decision:** no Resend/outbound-email
   integration exists anywhere in this codebase yet (verified:
   `grep -rli resend supabase/` returns nothing) — AD-13 assigns "outbound = Resend" to
   Epic 7 (reminders), not Epic 2. Building a first-ever email-sending pipeline here
   would duplicate infrastructure Epic 7 already owns. The product's existing capture
   pattern already leans on "share it yourself, any channel" (CAP-1); the invite link
   follows the same shape. Automating delivery is a natural Epic 7 fast-follow, not
   built here.

3. **An invite can be revoked before acceptance — the epic's own stated line.**
   `public.revoke_invite(p_invite_id bigint) returns void`, `SECURITY DEFINER`,
   `SET search_path = ''` (same reasoning as `create_invite()` — 2.7 AC-2 withholds
   every DML grant on `invites` from `authenticated`, so an invoker-rights `update`
   would be refused at the grant; the function's own explicit checks are the whole
   write gate). It starts with 2.7's explicit active-membership check on the invite's
   `account_id`, and raises unless the caller holds an invite-capable role in the
   invite's account, and unless the invite's `status = 'pending'` (an already-`accepted` invite
   cannot be "revoked" — that member is already in; removing them is Story 2.5's
   persona-removal path, a different action for a different state). Sets
   `status = 'revoked'`. `InvitesSection.tsx` lists pending invites with a "Revoke"
   button next to each.

4. **The invite list shows real state, not just "sent."** `useGetList("invites", …)`
   (RLS-scoped to the active context, per 2.7 AC-2) renders each invite's email, role,
   status (`pending`/`accepted`/`revoked`/`expired`), and — for `pending` ones — how
   long until it expires. `expired` is computed client-side from `expires_at < now()`
   for display (the row's stored `status` only flips to `'expired'` lazily — see Dev
   Notes "Expiry is read-time, not a background job" — this story does not add a cron
   sweep).

5. **The dataProvider gains `createInvite`/`revokeInvite`, mirrored in both providers
   (AD-10).** Thin RPC wrappers (`create_invite`/`revoke_invite`), following the exact
   shape established by every prior story's custom method in this epic. `invites`
   itself is registered as an ordinary resource (`useGetList("invites", …)` needs no
   custom method — it is a plain RLS-scoped table read, same as `singles` or
   `shidduchim`).
   `providers/fakerest/dataProvider.ts` gains an in-memory `db.invites` array and
   emulates both RPCs against it, plus the same owning-role/authority checks
   `create_invite`/`revoke_invite` enforce in Postgres.

6. **`invites` gets no route and no nav presence — decided, not left open.** The only
   surface is the embedded Settings widget (AC-1/AC-4); `useGetList("invites", …)`
   works against any table the dataProvider can reach and needs no
   `root/routeManifest.ts` entry, and a `/invites` page nobody links to would be dead
   weight. All UI copy lives under `crm.settings.invites_*` in both message
   catalogues; a `resources.invites` block is added **only** if ra-core's default
   notifications/labels for the `useGetList` calls surface a raw key in the UI —
   verify in the running app rather than adding it speculatively.

7. **The fork's admin-invite membership path is deleted — this story's title made
   literal.** The legacy path (a `members`-list admin creates a user directly:
   `members/MemberCreate.tsx` → `dataProvider.memberCreate()` → POST
   `supabase/functions/users` → `inviteUser()` → `auth.admin.inviteUserByEmail`) is a
   second membership mechanism, and it is already a corpse by this point in the epic:
   its invite email links to the set-password page 2.6 deleted, and its user creation
   is refused by 2.7's before-user-created hook. Deleted outright (NFR-14/FR119):
   the `inviteUser()` function and the `req.method === "POST"` branch in
   `supabase/functions/users/index.ts` (PATCH/`patchUser` — profile edits and account
   disabling — stays); `memberCreate` in both dataProviders;
   `members/MemberCreate.tsx` and its create registration (the `members` resource
   keeps list/edit); the now-unreferenced `[auth.email.template.invite]` block in
   `supabase/config.toml` and `supabase/templates/invite.html` (GoTrue's invite
   template is used only by `inviteUserByEmail`). Post-Epic-1 the only `memberCreate`
   caller is `MemberCreate.tsx` — `misc/useImportFromJson.ts`'s call was deleted with
   `/import` by story 1.1 (per 1.2's verified call-site table) — so nothing else
   breaks; verify with `grep -rn "memberCreate" src/` returning zero hits after.

8. **No second invite-creation path exists.** `grep -rn "insert into.*invites\|\.from(\"invites\").*insert" src/`
   returns no hit outside the one `createInvite` dataProvider method. This grep proves
   frontend hygiene only; the actual boundary is 2.7 AC-2's grant posture (no DML
   grant on `invites` for `authenticated`), which closes the raw-PostgREST path a
   grep over `src/` can never see.

9. **Toolchain green**: `make typecheck && npm run lint && make test &&
   npm run test:unit:db`.

## Tasks / Subtasks

- [ ] **Task 1 — `revoke_invite()`** (AC: 3)
  - [ ] `02_functions.sql`: implement per AC-3, reusing the **invite-capable-role**
        predicate `create_invite()` (2.7) already established (`role in
        ('parent_admin', 'self_manager', 'shadchan')` — deliberately distinct from
        2.2's owning-role helper, per 2.7 AC-3's note); factor it into one shared
        helper if 2.7 did not already, rather than repeating the literal list a third
        time.
  - [ ] `06_grants.sql`: `revoke all on function public.revoke_invite(bigint) from
        public, anon;` then `execute` to `authenticated` (the file's standard
        revoke-then-grant pattern).
  - [ ] Migration: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        invite_revocation`, hand-check, apply.

- [ ] **Task 2 — dataProvider** (AC: 5)
  - [ ] `providers/supabase/dataProvider.ts`: `createInvite(email, role)`,
        `revokeInvite(id)`.
  - [ ] `providers/fakerest/dataProvider.ts`: `db.invites` + emulated RPCs, including
        the authority checks.
  - [ ] No `root/routeManifest.ts` entry and no `/invites` route (AC-6 — decided).
        i18n keys land in Task 5.

- [ ] **Task 3 — `InvitesSection.tsx`** (AC: 1, 2, 3, 4)
  - [ ] New file, visual pattern matching `FamilySection.tsx`/`PersonasSection.tsx`
        (2.5). Form (AC-1), link + copy button (AC-2), list with revoke (AC-3/4).
  - [ ] Add to `settings/SettingsPage.tsx` and `settings/SettingsPageMobile.tsx`.

- [ ] **Task 4 — Delete the legacy admin-invite path** (AC: 7)
  - [ ] `supabase/functions/users/index.ts`: delete `inviteUser()` (lines 127-240 on
        `main`) and the `req.method === "POST"` branch in the `Deno.serve` router;
        keep `patchUser` and the PATCH branch.
  - [ ] Both dataProviders: delete `memberCreate` (the fakerest emulation too).
  - [ ] `git rm src/components/atomic-crm/members/MemberCreate.tsx`; remove it from
        `members/index.ts` and any create-route registration; keep list/edit.
  - [ ] `supabase/config.toml`: delete `[auth.email.template.invite]`;
        `git rm supabase/templates/invite.html`.
  - [ ] Verify: `grep -rn "memberCreate\|inviteUserByEmail" src/ supabase/functions/`
        returns zero hits.

- [ ] **Task 5 — Copy** (AC: all UI-facing)
  - [ ] New `crm.settings.invites_*` keys in both message catalogues.

- [ ] **Task 6 — Tests** (AC: 3, 8)
  - [ ] Extend `supabase/tests/invites.sql` (2.7) with `revoke_invite()`'s guard cases:
        a non-owning caller cannot revoke; an already-accepted invite cannot be revoked;
        a pending invite in a **different** context (not the caller's active one) is
        invisible to `revoke_invite()` entirely (RLS, not an application check).
  - [ ] Component test for `InvitesSection`: role selector options match the caller's
        own authority; revoke button only shown for `pending` rows. (Forward note:
        Epic 6 Story 6.1 later removes `single` from this generic selector — a
        single's login is invited from their own record instead — so that story, not a
        regression, is what changes this test's expected option list.)
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Expiry is read-time, not a background job

`invites.expires_at` is checked wherever it matters — `create_invite`/`get_invite_preview`/
the Auth Hook (Story 2.7) all compare against `now()` directly — rather than relying on
a stored `status = 'expired'` value a cron job would need to keep current. This story
does not add a sweep job (no `cron/` Worker exists yet in this codebase — that
infrastructure is Epic 7's, per the Capability→Architecture Map). `InvitesSection.tsx`'s
list computes the display label the same way, client-side, from `expires_at` — it does
not wait for a `status` flip that never happens automatically. If a genuinely stored
`expired` status is later wanted (e.g. so `revoke_invite` can distinguish "already
expired" from "still pending" in its own error message), that is a small addition for
whoever adds the cron infrastructure, not invented here.

### Why the parent↔shadchan connection is out of scope — traced precisely

AD-20: "A connection is a third scope, owned by neither party … `connections
(household_account_id, shadchanus_account_id, status)` records an explicitly accepted
link between exactly two contexts." Story 2.2's own
`enforce_membership_role_matches_context()` trigger makes it structurally impossible for
an invite to grant `role = 'shadchan'` inside a household account — which is exactly
what "inviting a shadchan" would otherwise attempt if this story tried to reuse
`create_invite()` unmodified for it. epics.md's own third bullet for this story
("the same mechanism establishes a parent↔shadchan connection (Epic 8)") is read here as
naming the **pattern** (token, consent, revocable) Epic 8 will extend once `connections`
exists — not as an instruction to build connection-establishment now, which would
require inventing `connections`' shape ahead of the epic that owns it.

### Verified current state

- No `invites`-table frontend exists at all today; the additive half of this story
  has nothing to collide with. The subtractive half's blast radius is verified small:
  post-Epic-1 the only `memberCreate` caller is `members/MemberCreate.tsx`
  (`useImportFromJson.ts`'s call went with `/import` in story 1.1), and
  `inviteUserByEmail` appears only inside `supabase/functions/users/index.ts`.
- `grep -rli resend supabase/` — zero hits, confirming AC-2's decision is grounded in
  the actual repo state, not assumed.
- `settings/FamilySection.tsx` — the "quiet summary section" pattern `InvitesSection.tsx`
  follows, same as `PersonasSection.tsx` (Story 2.5).

### Testing standards

Extend `supabase/tests/invites.sql` (2.7) rather than a new file — same suite, same
domain area. `.claude/rules/security-triggers.md`'s negative-test requirement covers
AC-3's cross-context invisibility case.

### Project Structure Notes

New: `settings/InvitesSection.tsx`. Edited: `settings/SettingsPage.tsx`,
`settings/SettingsPageMobile.tsx`, both `dataProvider.ts` files, `02_functions.sql`,
`06_grants.sql`, both message catalogues, `supabase/functions/users/index.ts`,
`members/index.ts`, `supabase/config.toml`. Deleted: `members/MemberCreate.tsx`,
`supabase/templates/invite.html`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.8] — the story's own AC
  text, including the Epic-8 forward reference this story's scope boundary is built
  around.
- [Source: ARCHITECTURE-SPINE.md#AD-20] — the connection scope this story explicitly
  does not build.
- [Source: ARCHITECTURE-SPINE.md#AD-13] — "outbound = Resend," owned by Epic 7, the
  basis for AC-2's decision.
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md]
  — `invites`, `create_invite()`, `role_authority()`, the OTP acceptance flow this
  story's UI feeds.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
