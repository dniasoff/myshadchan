---
baseline_commit: ebd413028b4e5cb799d0d52db91ac80bf6f51efe
---

# Story 2.8: Invites as the One Membership Mechanism

Status: review

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
predicate — see 2.7 AC-3's note; reuse each, re-derive neither). Story 2.2 is also what
adds `single` to `MemberRole` in `src/components/atomic-crm/types.ts:84-85`, which today
is only `parent_admin | helper | self_manager | shadchan` — AC-1's selector reads that
union, so it cannot offer `single` until 2.2 lands.

**Baseline: Epic 1 is merged.** This story was re-verified against the post-Epic-1 tree
(`sales`→`members`, `children`→`singles`, fossil resources gone, token portal gone,
route/resource registration moved from `<Resource>`/`<Route>` JSX into
`src/components/atomic-crm/root/routeManifest.ts`). Every file path, line number and
grep result below was re-run against that tree — see "Verified against the current tree".

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

1. **One screen sends every kind of household invite.** New
   `src/components/atomic-crm/settings/InvitesSection.tsx` (alongside the existing
   `FamilySection.tsx` and the new `PersonasSection.tsx` from Story 2.5): an email field
   and a role selector, calling `dataProvider.createInvite(email, role)` →
   `create_invite()` (Story 2.7). The role selector's options are computed client-side
   from the caller's own role via the **same** `role_authority()` ordering Story 2.7's
   function enforces server-side (client-side is UX only — `create_invite()`'s own
   check is the actual enforcement; the client list exists so a `helper` viewing the
   form sees no invitable options at all rather than an error after submitting). The
   option set is drawn from `MemberRole` (`types.ts:84-85`) **minus `self_manager`**,
   which 2.7 AC-1 excludes from `invites.role`'s check constraint by design.
   *Decided by:* the component test in Task 6 plus `make typecheck`.

2. **The invite link is shareable, not auto-emailed — a deliberate Phase-1 scope call.**
   On success, the screen shows `${origin}/#/accept-invite/${token}` with a copy button.
   No outbound email is sent by this story. **Decision, re-verified against the current
   tree:** no outbound-email *implementation* exists anywhere in this repo.
   `grep -rli resend supabase/` returns nothing; the single repo-wide hit is
   `workers/cron/wrangler.toml`, and it is a **comment** naming `RESEND_API_KEY` as a
   secret still to be set — there is no Resend client, no send call, and
   `workers/cron/index.ts`'s `scheduled()` handler is a stub that only
   `console.warn`s. The one email path that does exist,
   `supabase/functions/postmark/`, is **inbound** capture, not outbound delivery.
   AD-13 assigns "email … via Resend" to the reminders/notifications capability — its
   `Epic-7` label is the **pre-renumbering** spine numbering; in the current
   `epics.md`, Epic 7 is "Communication" and its **Story 7.5 (Notifications)** owns
   outbound delivery. Building a first-ever email-sending pipeline here would duplicate
   infrastructure that story owns. The product's existing capture pattern already leans
   on "share it yourself, any channel" (SPEC CAP-1); the invite link follows the same
   shape. Automating delivery is a natural Story 7.5 fast-follow, not built here.
   *Decided by:* `grep -rli resend . --exclude-dir=node_modules --exclude-dir=.git`
   returning only `workers/cron/wrangler.toml`, and no new file under `workers/` or
   `supabase/functions/` in this story's File List.

3. **An invite can be revoked before acceptance — the epic's own stated line.**
   `public.revoke_invite(p_invite_id bigint) returns void`, `SECURITY DEFINER`,
   `SET search_path = ''` (same reasoning as `create_invite()` — 2.7 AC-2 withholds
   every DML grant on `invites` from `authenticated`, so an invoker-rights `update`
   would be refused at the grant; the function's own explicit checks are the whole
   write gate). It starts with 2.7's explicit active-membership check on the invite's
   `account_id`, and raises unless the caller holds an invite-capable role in the
   invite's account, and unless the invite's `status = 'pending'` (an already-`accepted`
   invite cannot be "revoked" — that member is already in; removing them is Story 2.5's
   persona-removal path, a different action for a different state). Sets
   `status = 'revoked'`. `InvitesSection.tsx` lists pending invites with a "Revoke"
   button next to each.
   *Decided by:* `npm run test:unit:db` over the cases added to
   `supabase/tests/invites.sql` in Task 6.

4. **The invite list shows real state, not just "sent."** `useGetList("invites", …)`
   (RLS-scoped to the active context, per 2.7 AC-2) renders each invite's email, role,
   status (`pending`/`accepted`/`revoked`/`expired`), and — for `pending` ones — how
   long until it expires. `expired` is computed client-side from `expires_at < now()`
   for display (the row's stored `status` only flips to `'expired'` lazily — see Dev
   Notes "Expiry is read-time, not a background job" — this story does not add a cron
   sweep).
   *Decided by:* the `InvitesSection` component test in Task 6.

5. **The dataProvider gains `createInvite`/`revokeInvite`, mirrored in both providers
   (AD-10).** Thin RPC wrappers over `create_invite`/`revoke_invite`, following the
   exact `getSupabaseClient().rpc(…)` shape every prior custom method in
   `providers/supabase/dataProvider.ts` uses (e.g. `addRedt` at :243, `catchShidduch`
   at :283, `aiEntitlement` at :470). Both methods land inside
   `getDataProviderWithCustomMethods()`'s returned object, so they are picked up by
   `export type CrmDataProvider = ReturnType<…>` (`dataProvider.ts:500`) automatically —
   there is no separate provider-type file to edit (`providers/types.ts` only re-exports
   that inferred type).
   `providers/fakerest/dataProvider.ts` gains an in-memory `invites` collection and
   emulates both RPCs against it, plus the same owning-role/authority checks
   `create_invite`/`revoke_invite` enforce in Postgres. That collection must be declared
   on the `Db` interface (`providers/fakerest/dataGenerator/types.ts:21-40`) and seeded
   (at minimum as `[]`) by `generateData()`
   (`providers/fakerest/dataGenerator/index.ts:6`), or FakeRest has no `invites` store to
   read through `useGetList`.
   *Decided by:* `make typecheck` and the demo build starting (AD-10).

6. **`invites` gets no route and no nav presence — decided, not left open.** The only
   surface is the embedded Settings widget (AC-1/AC-4). Concretely, post-Epic-1:
   **do not add an `invites` entry to `RESOURCES` in
   `src/components/atomic-crm/root/routeManifest.ts`.** An entry whose `definition` has
   no `list`/`create`/`edit`/`show` is reported as an `empty-resource` violation by
   `findManifestViolations()`, which `routeManifest.test.ts`'s "returns no violations for
   the real manifest" test asserts is empty — so a speculative registration is a **test
   failure**, not dead weight. None is needed: `useGetList("invites", …)` reaches the
   table through the dataProvider's generic fall-through
   (`providers/supabase/dataProvider.ts:85-102` routes only `shidduchim` / `references` /
   `reference_links` to summary views and passes every other resource straight to
   `baseDataProvider.getList`), and ra-core's `useGetList` does not require a
   `<Resource>` to exist. All UI copy lives under `crm.settings.invites_*` in **both**
   message catalogues (`providers/commons/englishCrmMessages.ts`,
   `providers/commons/frenchCrmMessages.ts`); a `resources.invites` block is added
   **only** if ra-core's default notifications/labels for the `useGetList` calls surface
   a raw key in the UI — verify in the running app rather than adding it speculatively.
   *Decided by:* `npx vitest run --config vitest.config.ts --project app
   src/components/atomic-crm/root/routeManifest.test.ts`.

7. **The fork's admin-invite membership path is deleted — this story's title made
   literal.** The legacy path (a `members`-list admin creates a user directly:
   `members/MemberCreate.tsx` → `dataProvider.memberCreate()` → POST
   `supabase/functions/users` → `inviteUser()` → `auth.admin.inviteUserByEmail`) is a
   second membership mechanism, and it is already a corpse by this point in the epic:
   its invite email's only button points at `{{ .ConfirmationURL }}/auth-callback.html`
   (`supabase/templates/invite.html:61`) → `public/auth-callback.html` → the
   `#/auth-callback` "choose your password" flow 2.6 deletes, and its user creation is
   refused by 2.7's before-user-created hook. Deleted outright (NFR-14/FR119). The
   **full** blast radius, re-verified line-by-line against the current tree:
   - `supabase/functions/users/index.ts`: `inviteUser()` (**:127-240**) and the
     `req.method === "POST"` branch in the `Deno.serve` router (**:361-363**);
     **plus its two now-orphaned helpers** — `createMember()` (**:32-53**, whose only
     call site is `inviteUser` at :175) and `provisionAccountMembership()`
     (**:83-125**, plus its doc block at :74-82, whose only call sites are `inviteUser`
     at :184 and :224).
     **Kept:** `patchUser()` (:242-350) and the PATCH branch (:365-367) — profile edits
     and account disabling — together with `updateMemberDisabled()` (sig at :8),
     `updateMemberAdministrator()` (sig at :15) and `updateMemberAvatar()` (sig at :55),
     which `patchUser` still calls at :291, :319 and :323.
   - `memberCreate` in both dataProviders:
     `providers/supabase/dataProvider.ts:143-164` and
     `providers/fakerest/dataProvider.ts:511-520`.
   - `members/MemberCreate.tsx` (whole file), the `create: MemberCreate` line and its
     import in `members/index.ts`, **and the now-dead create affordance in
     `members/MemberList.tsx`** (`CreateButton` import at :2 and
     `<CreateButton label="resources.members.action.new" />` at :14 inside
     `MemberListActions`) — leaving it would render a button linking to a
     `/members/create` route that no longer resolves. The `members` resource keeps
     list/edit and therefore stays a valid `routeManifest.ts` `RESOURCES` entry.
   - The i18n keys that die with the screen, in **both** catalogues:
     `resources.members.create.*` and `resources.members.action.new` —
     `englishCrmMessages.ts:65-70` and `:77-79`; `frenchCrmMessages.ts:67-73` and
     `:80-82`. (Keep `resources.members.edit.*` and `fields.*`.)
   - `supabase/config.toml:101-103` (`[auth.email.template.invite]`) and
     `git rm supabase/templates/invite.html` — GoTrue's invite template is used only by
     `inviteUserByEmail`. **`public/auth-callback.html` stays**: it is still referenced
     by `supabase/templates/recovery.html:63` and by `additional_redirect_urls` in
     `supabase/config.toml:74` / `supabase/config.e2e.toml:75`.
   - Check whether `MemberFormData.password` (`types.ts:13`) still has a reader once
     both `memberCreate` implementations are gone (`memberUpdate` takes
     `Omit<MemberFormData, "password">`); drop the field if nothing reads it, rather
     than leaving a field only the deleted path ever set.

   Post-Epic-1 the only `memberCreate` **caller** is `MemberCreate.tsx`
   (`misc/useImportFromJson.ts`'s call went with `/import` in story 1.1 — re-verified:
   `src/components/atomic-crm/misc/` contains no such file and `grep -rn
   "useImportFromJson" src/` returns zero hits), so nothing else breaks.
   *Decided by:* `grep -rn "memberCreate" src/` returning **zero** hits after (it
   returns **3** today: `members/MemberCreate.tsx:20`,
   `providers/supabase/dataProvider.ts:143` and `:152`,
   `providers/fakerest/dataProvider.ts:511` — counting the two lines inside the supabase
   method as one site), plus `make typecheck && npm run lint`.

8. **No second invite-creation path exists.** After this story,
   `grep -rn '"invites"' src/` returns hits **only** in `settings/InvitesSection.tsx`
   (its `useGetList("invites", …)`) and `providers/fakerest/` (the `Db` key and its
   emulation) — and none of them is a `.insert(`/`.update(`/`.upsert(` against the
   table. (The older single-line `grep "insert into.*invites"` is not usable here: the
   supabase client is called as a multi-line chain — `getSupabaseClient().from("x")`
   then `.insert(...)` on following lines, see `dataProvider.ts:607-612` — so a
   one-line pattern would miss a real violation.) This grep proves frontend hygiene
   only; the actual boundary is 2.7 AC-2's grant posture (no DML grant on `invites` for
   `authenticated`), which closes the raw-PostgREST path a grep over `src/` can never
   see.

9. **Toolchain green**: `make typecheck && make lint && make test &&
   npm run test:unit:db`. (The repo's makefile is lowercase `makefile`; `typecheck`,
   `lint` and `test` are real targets at :125, :118 and :108, delegating to
   `npm run typecheck`, `npm run lint && npm run prettier`, and `npm run test`.
   `npm run test:unit:db` is the `db` vitest project.)

## Tasks / Subtasks

- [x] **Task 1 — `revoke_invite()`** (AC: 3)
  - [x] `supabase/schemas/02_functions.sql`: implement per AC-3, reusing the
        **invite-capable-role** predicate `create_invite()` (2.7) already established
        (`role in ('parent_admin', 'self_manager', 'shadchan')` — deliberately distinct
        from 2.2's owning-role helper, per 2.7 AC-3's note); factor it into one shared
        helper if 2.7 did not already, rather than repeating the literal list a third
        time. **Match the file's `pg_dump` formatting exactly**
        (`CREATE OR REPLACE FUNCTION "public"."name"(…)`, quoted identifiers) — every
        existing function in that file is in dump format, and deviating produces
        phantom diffs (AGENTS.md, "Database Management").
  - [x] `supabase/schemas/06_grants.sql`: follow the file's standard **triple**, not a
        pair — `revoke all on function public.revoke_invite(bigint) from public, anon;`
        then `grant execute … to authenticated;` **and** `grant execute … to
        service_role;` (the shape used at :197-240 for every function in the file).
  - [x] Migration: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        invite_revocation`, hand-check, apply with
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        **Hand-check gate:** the generated file must contain `revoke_invite` and its
        grants and nothing else — in particular **no `storage.objects` policy churn**.
        `supabase/schemas/07_storage.sql` holds three account-scoped attachment
        policies (commit `31183f2`) that live in a different schema file from every
        other policy; if `db diff` re-emits them, the local DB is out of sync with the
        schema — reset and re-apply, do not commit the churn.

- [x] **Task 2 — dataProvider** (AC: 5)
  - [x] `providers/supabase/dataProvider.ts`: `createInvite(email, role)` and
        `revokeInvite(id)` as `.rpc()` wrappers inside
        `getDataProviderWithCustomMethods()`'s returned object (same shape as
        `addRedt`/`catchShidduch`). No `providers/types.ts` edit — `CrmDataProvider` is
        inferred (`dataProvider.ts:500`).
  - [x] `providers/fakerest/dataGenerator/types.ts`: add `invites: Invite[]` to the `Db`
        interface. `providers/fakerest/dataGenerator/index.ts`: seed it in
        `generateData()`.
  - [x] `providers/fakerest/dataProvider.ts`: emulate both RPCs against that collection,
        including the authority checks.
  - [x] No `root/routeManifest.ts` entry and no `/invites` route (AC-6 — decided, and
        enforced by `routeManifest.test.ts`). i18n keys land in Task 5.

- [x] **Task 3 — `InvitesSection.tsx`** (AC: 1, 2, 3, 4)
  - [x] New file `settings/InvitesSection.tsx`, visual pattern matching
        `settings/FamilySection.tsx` / `settings/PersonasSection.tsx` (2.5). Form
        (AC-1), link + copy button (AC-2), list with revoke (AC-3/4).
  - [x] Add it to `settings/SettingsPage.tsx` (the left column, alongside
        `<ProfileSection />` / `<FamilySection />` / `<PreferencesSection />`) and to
        `settings/SettingsPageMobile.tsx` (the same stack at :37-40).

- [x] **Task 4 — Delete the legacy admin-invite path** (AC: 7)
  - [x] `supabase/functions/users/index.ts`: delete `inviteUser()` (:127-240), the
        `req.method === "POST"` branch (:361-363), and the two helpers it alone calls —
        `createMember()` (:32-53) and `provisionAccountMembership()` (:83-125). Keep
        `patchUser`, the PATCH branch, and the three `updateMember*` helpers still
        called from `patchUser`.
  - [x] Both dataProviders: delete `memberCreate`
        (`providers/supabase/dataProvider.ts:143-164`,
        `providers/fakerest/dataProvider.ts:511-520`).
  - [x] `git rm src/components/atomic-crm/members/MemberCreate.tsx`; remove the
        `create: MemberCreate` entry and its import from `members/index.ts`; remove the
        `CreateButton` import (:2) and usage (:14) from `members/MemberList.tsx`. Keep
        list/edit.
  - [x] Delete `resources.members.create.*` and `resources.members.action.new` from
        `providers/commons/englishCrmMessages.ts` (:65-70, :77-79) and
        `providers/commons/frenchCrmMessages.ts` (:67-73, :80-82).
  - [x] `supabase/config.toml`: delete `[auth.email.template.invite]` (:101-103);
        `git rm supabase/templates/invite.html`. Leave `public/auth-callback.html` and
        the `additional_redirect_urls` entries alone (still used by `recovery.html`).
  - [x] Re-check `MemberFormData.password` (`types.ts:13`) for a remaining reader; drop
        it if none.
  - [x] Verify: `grep -rn "memberCreate\|inviteUserByEmail\|createMember\|provisionAccountMembership" src/ supabase/functions/`
        returns zero hits, and `grep -rn "invite" supabase/config.toml` returns nothing.

- [x] **Task 5 — Copy** (AC: all UI-facing)
  - [x] New `crm.settings.invites_*` keys in **both** catalogues
        (`providers/commons/englishCrmMessages.ts`, `frenchCrmMessages.ts`), inside the
        existing `crm.settings` block (english :253, french :257).

- [x] **Task 6 — Tests** (AC: 3, 8)
  - [x] Extend `supabase/tests/invites.sql` (created by 2.7) with `revoke_invite()`'s
        guard cases: a non-owning caller cannot revoke; an already-accepted invite
        cannot be revoked; a pending invite in a **different** context (not the caller's
        active one) is invisible to `revoke_invite()` entirely (RLS, not an application
        check). Register it in the `db` vitest project the same way
        `supabase/tests/*.test.ts` files already do (see `members_rename.test.ts`,
        `billing_entitlement.test.ts`).
  - [x] Component test `settings/InvitesSection.test.tsx` (no `*.test.tsx` exists under
        `settings/` yet; follow `tasks/TasksListFilter.test.tsx` or
        `shidduchim/ShidduchCatchPanel.test.tsx`): role selector options match the
        caller's own authority; revoke button only shown for `pending` rows. (Forward
        note: Epic 6 Story 6.1 later removes `single` from this generic selector — a
        single's login is invited from their own record instead — so that story, not a
        regression, is what changes this test's expected option list.)
  - [x] `make typecheck && make lint && make test && npm run test:unit:db`.

## Dev Notes

### Expiry is read-time, not a background job

`invites.expires_at` is checked wherever it matters — `create_invite`/`get_invite_preview`/
the Auth Hook (Story 2.7) all compare against `now()` directly — rather than relying on
a stored `status = 'expired'` value a cron job would need to keep current. This story
does not add a sweep job. **Corrected against the current tree:** a `cron/` Worker *does*
now exist (`workers/cron/index.ts` + `workers/cron/wrangler.toml`, with a `*/15 * * * *`
trigger), but it is a **stub** — its `scheduled()` handler only `console.warn`s
`"[cron] sweep tick"`, and its own header comment says the reminders epic lands there
(AD-13). So the conclusion is unchanged, for a sharper reason: there is a cron surface,
but no sweep logic and no delivery, and filling it in belongs to the reminders/
notifications work, not here. `InvitesSection.tsx`'s list computes the display label
client-side from `expires_at` — it does not wait for a `status` flip that never happens
automatically. If a genuinely stored `expired` status is later wanted (e.g. so
`revoke_invite` can distinguish "already expired" from "still pending" in its own error
message), that is a small addition for whoever implements the cron sweep, not invented
here.

### Why the parent↔shadchan connection is out of scope — traced precisely

AD-20 ("A connection is a third scope, owned by neither party"):
"`connections(household_account_id, shadchanus_account_id, status)` records an
**explicitly accepted** link between exactly two contexts … Conversation rows scope by
`connection_id`, never `account_id`." Story 2.2's own
`enforce_membership_role_matches_context()` trigger makes it structurally impossible for
an invite to grant `role = 'shadchan'` inside a household account — which is exactly
what "inviting a shadchan" would otherwise attempt if this story tried to reuse
`create_invite()` unmodified for it. epics.md's own third bullet for this story
("the same mechanism establishes a parent↔shadchan connection (Epic 8)") is read here as
naming the **pattern** (token, consent, revocable) Epic 8 will extend once `connections`
exists — not as an instruction to build connection-establishment now, which would
require inventing `connections`' shape ahead of the epic that owns it.

### Verified against the current tree (post-Epic-1)

Re-run on the merged tree; every number below is a live grep, not a carried-forward
claim.

| Claim | Verified result |
| --- | --- |
| `invites`-table frontend already exists? | **No** — zero hits for `"invites"` under `src/`; the additive half of this story has nothing to collide with. |
| `memberCreate` hits under `src/` | **3** (`members/MemberCreate.tsx:20`; `providers/supabase/dataProvider.ts:143` + `:152`; `providers/fakerest/dataProvider.ts:511`) — 1 caller, 2 implementations. |
| `useImportFromJson` hits | **0** — the file is gone from `misc/` (story 1.1 took it with `/import`), confirming the "only caller is `MemberCreate.tsx`" claim. |
| `inviteUserByEmail` hits | **1** (`supabase/functions/users/index.ts:215`), inside `inviteUser`. |
| `inviteUser()` span | **:127-240** (`patchUser` begins at :242) — the original story's line range still holds. |
| Helpers orphaned by deleting `inviteUser` | **2** — `createMember()` (:32-53, sole caller :175) and `provisionAccountMembership()` (:83-125, sole callers :184, :224). *Newly found; the previous draft did not list these.* |
| `resend` hits under `supabase/` | **0**. Repo-wide: **1**, `workers/cron/wrangler.toml`, a comment naming `RESEND_API_KEY`. No client code anywhere. |
| `settings/` sections today | `ProfileSection`, `FamilySection`, `PreferencesSection`, `PrivacySection` (+ `ChangePasswordButton`, `DeleteDataDialog`, `SectionLabel`, `exportFamilyData.ts`). `PersonasSection` is 2.5's, not yet present. |
| Route/resource registration | `root/routeManifest.ts` (`CUSTOM_ROUTES` / `RESOURCES` + `findManifestViolations`), mapped over by the two admin surfaces. `members` is a `desktop`-only `RESOURCES` entry. No `<Resource>`/`<Route>` JSX to edit. |
| `members/MemberList.tsx` create affordance | **Present** — `CreateButton` at :2 and :14. *Newly found; must be removed with `MemberCreate.tsx`.* |
| Message catalogues | `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts`, merged by `providers/commons/i18nProvider.ts`. `crm.settings` block at en:253 / fr:257. |
| `supabase/tests/` today | `billing_entitlement`, `members_rename`, `references_entity`, `shidduch_catch` (`.sql` + `.test.ts` pairs). `invites.sql` arrives with 2.7. |
| Toolchain | lowercase `makefile`; `test:` (:108) → `npm run test`, `lint:` (:118) → `npm run lint && npm run prettier`, `typecheck:` (:125) → `npm run typecheck`. `npm run test:unit:db` = the `db` vitest project. |

**Nothing in this story was made already-done or impossible by Epic 1.** The two ACs
worth calling out:
- **AC-6 is a decided non-action, not a build step.** Epic 1's story 1.5 moved
  registration into `routeManifest.ts` and `invites` is (correctly) absent. The work is
  to *not* add it — and that non-action is now machine-checked, because adding an empty
  resource entry fails `routeManifest.test.ts`.
- **AC-7 is fully outstanding.** Every piece of the legacy admin-invite path is still
  present in the tree (`MemberCreate.tsx`, both `memberCreate` implementations,
  `inviteUser()`, the POST branch, `[auth.email.template.invite]`, `invite.html`) —
  Epic 1 removed none of it. Its blast radius is *larger* than the previous draft
  stated, by three items: the two orphaned edge-function helpers, the `MemberList`
  `CreateButton`, and the dead `resources.members.create.*` / `action.new` i18n keys.

### Testing standards

Extend `supabase/tests/invites.sql` (2.7) rather than a new file — same suite, same
domain area. `.claude/rules/security-triggers.md`'s negative-test requirement covers
AC-3's cross-context invisibility case (a new `SECURITY DEFINER` function on a table
with no client DML grant is an unambiguous security-review trigger).

### Project Structure Notes

**New:** `settings/InvitesSection.tsx`, `settings/InvitesSection.test.tsx`.
**Edited:** `settings/SettingsPage.tsx`, `settings/SettingsPageMobile.tsx`,
`providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts`,
`providers/fakerest/dataGenerator/types.ts`,
`providers/fakerest/dataGenerator/index.ts`, `supabase/schemas/02_functions.sql`,
`supabase/schemas/06_grants.sql`, `providers/commons/englishCrmMessages.ts`,
`providers/commons/frenchCrmMessages.ts`, `supabase/functions/users/index.ts`,
`members/index.ts`, `members/MemberList.tsx`, `supabase/config.toml`,
`supabase/tests/invites.sql`, `src/components/atomic-crm/types.ts` (only if
`MemberFormData.password` proves unread).
**Deleted:** `members/MemberCreate.tsx`, `supabase/templates/invite.html`.
**Deliberately untouched:** `root/routeManifest.ts` (AC-6),
`supabase/schemas/07_storage.sql`, `supabase/schemas/05_policies.sql` (this story adds a
function and grants, no policy).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.8] (epics.md:436-448) — the
  story's own AC text, including the Epic-8 forward reference this story's scope
  boundary is built around.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-20]
  (spine:153-156) — the connection scope this story explicitly does not build.
  *(Path corrected: the spine is not at the repo root.)*
- [Source: …/ARCHITECTURE-SPINE.md#AD-13] (spine:118-121) — "email (the guaranteed
  non-smartphone floor, via Resend)", the basis for AC-2's decision. Its `Epic-7` label
  is pre-renumbering; the owning story in the current epics.md is **7.5 Notifications**.
- [Source: …/ARCHITECTURE-SPINE.md#AD-10] (spine:103-106) — "every new resource/method
  is mirrored in the FakeRest provider", the basis for AC-5.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#CAP-1] (SPEC.md:26-28) —
  "capture from any channel", the share-it-yourself precedent AC-2 follows.
- [Source: _bmad-output/planning-artifacts/epics.md#FR119] (epics.md:87) — "invites are
  the one mechanism for household membership", the requirement AC-7 makes literal.
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md]
  — `invites`, `create_invite()`, `role_authority()`, `get_invite_preview()`, the OTP
  acceptance flow this story's UI feeds.
- [Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md] — the story
  that introduced `root/routeManifest.ts` and its violation validator.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow.

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f invite_revocation` emitted only the three function bodies (`is_invite_capable_role`, `revoke_invite`, `create_invite` re-emitted for its refactored body) — as the story's landmine warns, no GRANT/REVOKE statements at all. Hand-added the two triples (`is_invite_capable_role(text)`, `revoke_invite(bigint)`) into the generated migration before applying. No `storage.objects` churn appeared (confirmed by reading the generated file in full).
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local` applied cleanly; verified post-apply with a direct `psql` grant check (`has_function_privilege`) confirming `authenticated`/`service_role` hold EXECUTE on both new functions and `anon` holds neither.
- Ran `supabase/tests/invites.sql` directly via `psql` (wrapped in the same `begin; delete from account_members; \i ...; rollback;` isolation `invites.test.ts` uses) before trusting the vitest run — all 52 checks passed, including the 8 new revoke_invite() checks.
- `npm run test:unit:db` (325/325, 6 suites), `npx vitest run --project app src/components/atomic-crm/settings/InvitesSection.test.tsx` (4/4), `npx vitest run --project app src/components/atomic-crm/root/routeManifest.test.ts` (6/6 — confirms AC-6's non-registration), `make typecheck`, `make lint` (eslint + prettier), `make test` (825/825) all green on the final pass.

### Completion Notes List

- **Task 1.** Factored the invite-capable-role predicate (`role in ('parent_admin', 'self_manager', 'shadchan')`) out of `create_invite()` into a new shared `is_invite_capable_role(p_role text)` IMMUTABLE helper (`02_functions.sql`), used by both `create_invite()` (refactored) and the new `revoke_invite(p_invite_id bigint)`. `revoke_invite()` scopes its invite lookup to `current_context_id()` — deliberately the SAME predicate the "Invites readable within active account" SELECT policy uses — so an invite belonging to an account the caller is not CURRENTLY active in is simply not found (a `not found` raise from the lookup itself), never a distinct "insufficient privilege" branch for that specific case. Verified this distinction with a dedicated cross-context test (see Task 6).
- **Task 2.** Added `createInvite`/`revokeInvite` to `providers/supabase/dataProvider.ts` as thin `.rpc()` wrappers (same shape as `addRedt`/`catchShidduch`). FakeRest mirror lives in a new `providers/fakerest/internal/invites.ts` module (following the established `internal/` convention — `personas.ts`, `contexts.ts`, `removePersona.ts`), sharing the closure-local `activeAccountId` `contexts.ts`/`removePersona.ts` already use. Added `invites: Invite[]` to the `Db` interface, seeded `[]` in `generateData()`.
- **Task 3.** New `settings/InvitesSection.tsx`: a send form (email + role `Select`, options from a new shared `providers/commons/roleAuthority.ts` TypeScript mirror of `role_authority()`/`is_invite_capable_role()`), a shareable copyable `${origin}/#/accept-invite/${token}` link shown on success, and a list of every invite (email/role/status, "expires in…" for still-pending ones, Revoke button only on rows whose EFFECTIVE status — folding a `pending` row past its own `expires_at` to `expired` for display, per AC-4 — is `pending`). Mounted in both `SettingsPage.tsx` and `SettingsPageMobile.tsx` alongside `PersonasSection`.
- **Task 4.** Deleted `inviteUser()`, the POST branch, and its two now-orphaned helpers (`createMember()`, `provisionAccountMembership()`) from `supabase/functions/users/index.ts`; kept `patchUser` and its three `updateMember*` helpers. Deleted both `memberCreate` implementations, `members/MemberCreate.tsx`, its `create:`/`CreateButton` wiring, the dead `resources.members.create.*`/`action.new` i18n keys (both catalogues), and `[auth.email.template.invite]` + `templates/invite.html` from **both** `config.toml` and `config.e2e.toml` (the story's own landmine: missing the e2e side breaks `.supabase-e2e` startup). `MemberFormData.password` had zero remaining readers once both `memberCreate`s were gone (confirmed by `grep -rn "\.password\b"` over `src/`) — dropped it, and simplified the two now-pointless `Omit<MemberFormData, "password">` call-site types to plain `Partial<MemberFormData>`.
- **Task 5.** `crm.settings.invites_*` keys added to both catalogues inside the existing `crm.settings` block.
- **Task 6.** Extended `supabase/tests/invites.sql` with `revoke_invite()`'s three guard cases plus a happy-path/re-revoke pair (8 new checks total) — no new `.sql`/`.test.ts` file needed since `invites.test.ts` (2.7) already runs every check the `.sql` file emits generically. New `settings/InvitesSection.test.tsx` (first `*.test.tsx` under `settings/`), covering the role-selector-matches-authority case (positive: parent_admin sees parent_admin/helper/single, never shadchan; negative: a helper sees no options and no form at all) and the revoke-button-only-for-pending case (including the expired-but-still-stored-pending edge case).
- **Story claim that did not reproduce:** AC-7's own verification line says `grep -rn "invite" supabase/config.toml` should return nothing after this story. It does not — `[auth.hook.before_user_created]`'s comment block and its `uri = "pg-functions://postgres/public/check_signup_invite"` line both contain the substring "invite", and that hook is Story 2.7's own surviving, load-bearing config (never a target of this story's deletion). Verified the ACTUAL target instead: `grep -n "auth.email.template.invite\]" supabase/config.toml supabase/config.e2e.toml` and `ls supabase/templates/ | grep -i invite` both return nothing — the admin-invite template and its config block are genuinely gone from both files.
- Everything else in the story reproduced as described; no other AC or Task required deviation.

### File List

**New:**
- `src/components/atomic-crm/settings/InvitesSection.tsx`
- `src/components/atomic-crm/settings/InvitesSection.test.tsx`
- `src/components/atomic-crm/providers/commons/roleAuthority.ts`
- `src/components/atomic-crm/providers/fakerest/internal/invites.ts`
- `supabase/migrations/20260728070135_invite_revocation.sql`

**Modified:**
- `supabase/schemas/02_functions.sql` — added `is_invite_capable_role()`, `revoke_invite()`; refactored `create_invite()` to call the new shared helper.
- `supabase/schemas/06_grants.sql` — added the grant triples for both new functions.
- `supabase/tests/invites.sql` — added `revoke_invite()`'s guard/happy-path checks; updated the file header comment.
- `src/components/atomic-crm/types.ts` — added `Invite`, `InvitableRole`; dropped `MemberFormData.password`.
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` — added `createInvite`/`revokeInvite`; deleted `memberCreate`; simplified `memberUpdate`'s param type.
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` — added `createInvite`/`revokeInvite` wiring; deleted `memberCreate`; simplified `memberUpdate`'s param type; updated two now-stale `getInvitePreview`/`acceptInvite` comments.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/types.ts` — added `invites: Invite[]` to `Db`.
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts` — seeded `db.invites = []`.
- `src/components/atomic-crm/settings/SettingsPage.tsx` — mounted `<InvitesSection />`.
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx` — mounted `<InvitesSection />`.
- `src/components/atomic-crm/members/index.ts` — removed the `create: MemberCreate` entry/import.
- `src/components/atomic-crm/members/MemberList.tsx` — removed the `CreateButton` import/usage.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` — removed `resources.members.create.*`/`action.new`; added `crm.settings.invites_*`.
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` — same, French.
- `supabase/functions/users/index.ts` — deleted `inviteUser()`, the POST branch, `createMember()`, `provisionAccountMembership()`.
- `supabase/config.toml` — deleted `[auth.email.template.invite]`.
- `supabase/config.e2e.toml` — deleted `[auth.email.template.invite]`.
- `registry.json` — regenerated (`make registry-gen`, pre-commit hook territory but run explicitly here): added the three new component files, removed `MemberCreate.tsx`'s entry.

**Deleted:**
- `src/components/atomic-crm/members/MemberCreate.tsx`
- `supabase/templates/invite.html`
