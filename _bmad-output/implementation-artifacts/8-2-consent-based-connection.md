# Story 8.2: Consent-based connection

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent (or a shadchan),
I want a connection to another context to exist only after the other side explicitly accepts,
so that nobody reaches me, or a family I don't yet know, without consent.

## Position in Epic 8

**2nd of 5.** Depends on **8.1** for the `/connections` placeholder and route-guard mechanics,
and on **Epic 7 Story 7.4**, which already created the `public.connections` table (see "What
7.4 shipped and what this story adds"). Everything downstream depends on this story: **8.3**
(redting) cannot resolve a household without an accepted connection; **8.4**'s negative tests
assume connections exist; **8.5**'s Connections list/360 renders this story's data.

## What 7.4 shipped and what this story adds

Epic 7 Story 7.4 created `public.connections` as shared scaffolding — its own text states
"**Epic 8 must not re-create this table, its kind-enforcement trigger or its RLS policy** —
it `ALTER`s and extends what this story ships." What exists when this story starts (7.4's
final shape — its status vocabulary and uniqueness were deliberately chosen so this story's
extension is purely additive):

- `connections(id, household_account_id, shadchanus_account_id, status, created_at, ended_at)`
  with `status ∈ ('accepted','ended')`, default `'accepted'` — **no `'pending'`**: per AD-20 a
  row exists only once accepted, and the proposed-not-yet-accepted state lives entirely in this
  story's `connection_invites`;
- a **partial** unique index `connections_live_pair_idx` on
  `(household_account_id, shadchanus_account_id) where status = 'accepted'` — at most one live
  connection per pair, and reconnection after an end is a **new** row;
- the `enforce_connection_kinds()` trigger (before insert or update) rejecting a row
  whose two accounts are not household + shadchanus respectively (AD-2, AD-20);
- `FORCE ROW LEVEL SECURITY` with **one select-only policy** (either party's member reads),
  **no** insert/update/delete policy, `anon` revoked, `authenticated` granted select only.

This story therefore **ALTERs, never CREATEs**: it adds the consent workflow (invites +
`SECURITY DEFINER` write functions) and the columns that workflow needs. Because
7.4 grants `authenticated` no DML on `connections`, **every write function in this story must
be `SECURITY DEFINER`** — a `SECURITY INVOKER` update would be refused at the grant, before
RLS is even consulted.

## Acceptance Criteria

1. **A connection exists only after explicit acceptance.** A `connections` row is created
   **only** by accepting a connection invite (AC-3); 7.4's no-client-write posture is
   preserved — the only writers are this story's `SECURITY DEFINER` functions.
2. **No directory-driven or automatic linkage (FR109).** A connection can only be initiated by
   one party generating an invite link and sharing it out-of-band; there is no search, browse or
   suggestion mechanism that surfaces one account to another. Public discoverability is Epic 9's
   listings, not this story's.
3. **Either side may end it.** An active member of either the household account or the
   shadchanus account can end an accepted connection; ending is immediate and irreversible for
   that connection row (a new connection between the same pair is a **new** invite/accept cycle,
   not a reactivation).
4. **A connection can only ever link one household to one shadchanus context — never two of the
   same kind.** Attempting to accept an invite from a household as another household (or a
   shadchanus as another shadchanus) is rejected at the database, not just in the UI — by the
   accept function's kind check and, beneath it, 7.4's `enforce_connection_kinds()`
   trigger.
5. **Visibility of a `connections` row is exactly its two parties.** A member of a household or
   shadchanus account not referenced by the row cannot read it, list it, or infer its existence
   (7.4's select policy; re-proven here with this story's real rows, AC-6).
6. **Verification — negative tests, at the database.**
   - A member of household C (party to no connection with shadchan S) cannot read the
     `connections` row between household A and shadchan S.
   - A member of shadchanus account S2 cannot call `end_connection()` on a connection between
     household A and shadchanus S1.
   - Accepting a connection invite issued by a household from another household's active context
     (same kind on both sides) is rejected with an error, and no row is created.
   - A revoked or expired connection invite cannot be accepted.
   - Accepting the same invite twice does not create two connection rows (idempotency /
     single-use).
   - A direct `insert`/`update` on `connections` and on `connection_invites` as `authenticated`
     is refused (the no-client-write posture holds after this story's grants).

## Tasks / Subtasks

- [ ] **Task 1 — Schema: ALTER `connections`** (AC: 1, 3, 4, 5)
  - [ ] `supabase/schemas/01_tables.sql`, on 7.4's existing table. 7.4 shipped no client or RPC
        write path, so no real `connections` row can predate this story — only local test
        fixtures. The migration may therefore start with `delete from public.connections;`
        (dev-fixture hygiene) so the `not null` add below is safe:
    ```sql
    alter table public.connections
        add column proposed_by_account_id bigint not null references public.accounts(id),
        add column accepted_at timestamptz,
        add column ended_by_account_id bigint references public.accounts(id);
    alter table public.connections add constraint connections_ended_consistency
        check ((status = 'ended') = (ended_at is not null));
    ```
    That is the whole delta. 7.4 already ships the `('accepted','ended')` status vocabulary
    (default `'accepted'`, no `'pending'`) and the live-pair partial unique index
    `connections_live_pair_idx` — do **not** touch `connections_status_check` or the index,
    and do **not** re-declare the table, its `enforce_connection_kinds()` trigger, its RLS or
    its grants — all 7.4's.
    (7.4's own SQL test suite creates its fixtures inside the test script; if any of its
    fixture inserts omit the new `proposed_by_account_id`, updating those inserts is in-scope
    for this story — fix them in place, do not fork the suite.)
  - [ ] Add `connection_id bigint references public.connections(id) unique` (nullable) to
        `public.shadchanim`. Populated only by `accept_connection_invite()` (Task 3) — never
        client-writable: switch `shadchanim`'s `insert`/`update` grants to column-list grants
        that omit `connection_id`, following `06_grants.sql`'s existing column-grant precedent
        (`grant update (body, metadata) on table public.interactions`,
        `grant update (name, transparency_level, data_region) on public.accounts`).

- [ ] **Task 2 — Schema: `connection_invites`** (AC: 2, 6)
  - [ ] Add:
    ```sql
    create table public.connection_invites (
        id bigint generated by default as identity primary key,
        created_at timestamptz not null default now(),
        inviter_account_id bigint not null references public.accounts(id),
        inviter_kind text not null,
        token_hash text not null unique,
        status text not null default 'pending',
        expires_at timestamptz not null,
        accepted_by_account_id bigint references public.accounts(id),
        accepted_at timestamptz,
        revoked_at timestamptz,
        constraint connection_invites_status_check check (status in ('pending', 'accepted', 'revoked', 'expired')),
        constraint connection_invites_inviter_kind_check check (inviter_kind in ('household', 'shadchanus'))
    );
    ```
    A **sibling** table to Epic 2's household-membership `invites` (Story 2.7), not a shared
    row in it — see Dev Notes "Why a sibling table, not a shared one".
  - [ ] The token itself is never stored: only `token_hash`. Generate with
        `encode(extensions.gen_random_bytes(32), 'hex')`, hash with
        `encode(extensions.digest(token, 'sha256'), 'hex')` — both pgcrypto, present in the
        `extensions` schema on every Supabase database (no in-repo helper survives Epic 1:
        Story 1.1 deletes `get_avatar_for_email` and 1.4 deletes the portal-token trigger).
        This deliberately diverges from 2.7's stored-raw-uuid invite token: a connection
        invite links two accounts across the tenant boundary, so a read of the table must
        never yield a usable token. The raw token is returned **once**, from
        `create_connection_invite()`, and never persisted in plaintext anywhere.
  - [ ] RLS: `FORCE ROW LEVEL SECURITY`; **one select policy**,
        `using (inviter_account_id = current_context_id())` — the issuer manages their own
        outstanding invites. No insert/update/delete policy and no DML grant to
        `authenticated`: all writes go through Task 3's functions, so a client can never
        hand-craft an invite row with a chosen `expires_at` or `token_hash` (same posture 7.4
        set for `connections`, and AD-9's spirit: recipients authenticate via the token in the
        URL, never via a table read). `revoke all on table public.connection_invites from anon;
        grant select on table public.connection_invites to authenticated; grant all ... to
        service_role;` in `06_grants.sql`.

- [ ] **Task 3 — Functions** (AC: 1, 2, 3, 4, 6). All five are `SECURITY DEFINER`,
      `SET search_path = ''`, following the `handle_new_user()` precedent
      (`supabase/schemas/02_functions.sql`) — see Dev Notes "Why every writer is SECURITY
      DEFINER". Every writer starts with an explicit active-membership check
      (`exists (select 1 from public.account_members am where am.account_id = <the account>
      and am.user_id = auth.uid() and am.status = 'active')`).
  - [ ] `public.create_connection_invite() returns text`: caller must be an active member of
        `current_context_id()`; inserts a `connection_invites` row with
        `inviter_account_id := current_context_id()`, `inviter_kind := (select kind from
        public.accounts where id = current_context_id())`, `expires_at := now() + interval
        '7 days'`; returns the **raw** token once.
  - [ ] `public.revoke_connection_invite(p_invite_id bigint)`: caller must be an active member
        of the invite's `inviter_account_id`; sets `status = 'revoked'`, `revoked_at := now()`.
        Raises if not `pending`.
  - [ ] `public.preview_connection_invite(p_token text) returns table(inviter_name text,
        inviter_kind text, status text, expires_at timestamptz)` (read-only): the acceptor has
        no select path to the row (Task 2), so this is the one purpose-built read letting the
        accept screen show "You've been invited by The Klein Family" before the user commits
        (`inviter_name` = `accounts.name`). Returns an empty set — not an error — for an
        unknown, expired or consumed token, so enumeration learns nothing beyond "not open".
        Mirrors 2.7's `get_invite_preview()` shape: named fields only, never the token or ids.
  - [ ] `public.accept_connection_invite(p_token text) returns public.connections`:
        1. Look up by `token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')` with
           `select ... for update`; must be `status = 'pending'` and `expires_at > now()`,
           else raise (AC-6 revoked/expired).
        2. Caller must be an active member of `current_context_id()`, and that account's
           `kind` must differ from `invite.inviter_kind` — else raise "a connection links a
           household and a shadchanus context, not two of the same kind" (AC-4).
        3. Resolve `household_account_id` / `shadchanus_account_id` from whichever of
           inviter/acceptor is which kind.
        4. Insert the `connections` row (`status := 'accepted'`, `accepted_at := now()`,
           `proposed_by_account_id := invite.inviter_account_id`).
        5. Insert the household's book entry: a `shadchanim` row in `household_account_id`
           with `name := (select name from public.accounts where id =
           shadchanus_account_id)`, `connection_id := <new connection id>`. This is what
           makes the shadchan appear in the household's own book (Shadchan 360, Story 5.9)
           from the moment of connecting.
        6. Mark the invite `status = 'accepted'`, `accepted_by_account_id`, `accepted_at`.
        7. Return the new `connections` row.
        Steps 4–6 run in the same transaction as step 1's row-lock, closing the double-accept
        race (AC-6 idempotency).
  - [ ] `public.end_connection(p_connection_id bigint) returns public.connections`: caller
        must be an active member of `household_account_id` **or** `shadchanus_account_id`;
        sets `status = 'ended'`, `ended_at := now()`, `ended_by_account_id :=
        current_context_id()`. Raises if already ended.
  - [ ] Grant `execute` on all five functions to `authenticated` only — **never** `anon`
        (AD-1: the only anon-readable relation is Epic 9's future `listings`). Accepting
        requires already being logged in with the opposite-kind context active; there is no
        anonymous acceptance path in this phase.

- [ ] **Task 4 — Migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        connection_consent`. Hand-check the generated migration (AGENTS.md: migrations are
        generated but sometimes need manual adjustment): it must contain the `ALTER TABLE`
        forms from Task 1 — never a `DROP`+`CREATE` of `connections` — plus
        `connection_invites` with its `FORCE ROW LEVEL SECURITY` and
        `revoke ... from anon` in the **same** migration (AD-1).
  - [ ] Apply with `migration up --local`, never `db reset`/`db push`.

- [ ] **Task 5 — Types and dataProvider** (AC: all)
  - [ ] `types.ts`: add `Connection`, `ConnectionInvite` interfaces matching the tables.
  - [ ] `providers/supabase/dataProvider.ts` custom-methods overlay (same seam as
        `createShidduchViaRpc`, AD-10): `createConnectionInvite()`, `revokeConnectionInvite()`,
        `previewConnectionInvite(token)`, `acceptConnectionInvite(token)`,
        `endConnection(connectionId)` — each a thin `getSupabaseClient().rpc(...)` wrapper
        matching `createShidduchViaRpc`'s shape exactly (destructure `{ data, error }`,
        log+throw on error).
  - [ ] Mirror all five in `providers/fakerest/` (AD-10): extend the `db.connections` fixture
        7.4 already added, add an in-memory `connection_invites` array, and reproduce the
        kind/status/expiry validation in the fakes (not skipped) so demo mode exercises the
        same guard rails.

- [ ] **Task 6 — Minimal UI to exercise the flow** (AC: 1, 2, 3)
  - [ ] A "Connect with a shadchan" action (household side: the Shadchanim list or Settings)
        calling `createConnectionInvite()` and showing the resulting link
        (`${origin}/#/connect/${token}` — token in the URL, mirroring 2.8's share-it-yourself
        invite-link pattern) with a copy button. Mirror action "Connect with a family" on the
        shadchan side (Settings, or Story 8.1's dashboard placeholder).
  - [ ] An accept screen at `/connect/:token` (registered in `root/routeManifest.ts`):
        `previewConnectionInvite(token)` on load to show who is inviting, then
        `acceptConnectionInvite()` on confirm; on success route the shadchan side to
        `/connections` (8.1's placeholder until 8.5) and the household side to `/shadchanim`
        (where the auto-created book row now is). The polished Connections list/360 is
        **Story 8.5's** — this task only needs the flow to work.
  - [ ] An "End connection" action wherever the connection is visible (minimal — a button
        calling `endConnection()`), refined visually by Story 8.5.
  - [ ] All new copy (the two "Connect with…" actions, the accept screen, the "End connection"
        confirm) through the `i18nProvider` (AD-18), keys added to **both**
        `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` — the shipped
        second catalogue is French, not Hebrew (Story 8.1 Dev Notes, "Why no Tasks or
        Reminders", carries the same AD-18-vs-reality note; not repeated in full here).

- [ ] **Task 7 — Negative-test suite** (AC: 6)
  - [ ] New `supabase/tests/shadchan_connections.sql` + `.test.ts`, following the
        `results`/`ids` temp-table and `set local role authenticated; set local
        request.jwt.claims ...` conventions of `supabase/tests/references_entity.sql`. Cover,
        in order: (a) household C cannot read A↔S's connection; (b) shadchan S2 cannot end
        A↔S1's connection; (c) same-kind acceptance is rejected and creates no row; (d) an
        expired or revoked invite cannot be accepted; (e) accepting the same invite twice
        yields exactly one `connections` row (`count(*) = 1`); (f) direct
        `insert`/`update` on `connections` and `connection_invites` as `authenticated` fails.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db` (needs
        `make start`), plus `npx prettier --config ./.prettierrc.json --check` over this
        story's changed files only (repo-wide prettier is Epic 1 Story 1.6's gate).

## Dev Notes

### Why a sibling table, not a shared one

FR119 / AD-11 make invites "the one mechanism" at the **product** level — generate a token,
share the link out-of-band, the other party accepts — and this story keeps that shape. It does
not reuse Epic 2's `invites` table rows: Story 2.8's own "Scope boundary" section explicitly
declines to build the parent↔shadchan connection and states "the connection flows are its
Story 8.2; the `connections` table itself is introduced earlier, by Epic 7's Story 7.4 ...
what this story delivers is the **pattern** those stories extend: a token-based,
consent-required, revocable-before-acceptance invite row" [Source:
_bmad-output/implementation-artifacts/2-8-invites-as-the-one-membership-mechanism.md —
"Scope boundary — what this story does not build"]. It names the pattern to extend, not the
table to reuse — the two flows differ in a load-bearing way — a membership invite grants a
role to a person inside the inviter's **own** account,
while a connection invite links **two already-existing, opposite-kind accounts** with neither
becoming a member of the other. A polymorphic merge would force 2.7's columns (`email`,
`role`) to be nullable-and-meaningless for connections. Sibling table chosen; decision stated
here, not left open.

### Why every writer is SECURITY DEFINER

7.4 shipped `connections` read-only to `authenticated` — no DML grant, no write policy —
precisely so a client cannot self-grant a connection (its Dev Notes walk the attack). This
story keeps that posture and extends it to `connection_invites`. Consequence: `SECURITY
INVOKER` functions cannot write either table (refused at the grant), so all four writers are
`SECURITY DEFINER` with explicit active-membership checks. The codebase precedent for a
definer function writing where the caller cannot is `public.handle_new_user()`
(`supabase/schemas/02_functions.sql`) — same ownership/grant shape, `SET search_path = ''`.
`accept_connection_invite()` additionally writes a `shadchanim` row into the **household's**
account while the acceptor may be the shadchan — a cross-account write only a definer
function can make.

### What ending does and does not do

`end_connection()` flips `status`/`ended_at`/`ended_by_account_id` and nothing else. The row
is kept (history, and 8.5's Connection 360 still renders it); threads and inbox items already
created through the connection are untouched — ending is **not retroactive**. What it blocks
is the future: no new redt (Story 8.3's function requires `status = 'accepted'`) and no
reactivation — reconnecting is a new invite/accept cycle producing a new row, which the
live-pair partial index permits and the ended row's history survives.

### Architecture citations

- **AD-20**: "`connections(household_account_id, shadchanus_account_id, status)` records an
  explicitly accepted link between exactly two contexts; either side may end it (FR109).
  ...No directory-driven or automatic linkage: a connection exists only after acceptance."
- **AD-11**: "Invites are the one mechanism (FR119) for adding a member to a household, giving
  a single their own login, and proposing a parent↔shadchan connection." Governs the
  invite-based shape over a bare propose/accept RPC pair with no token.
- **AD-1**: `connection_invites` is a new table — RLS and the `anon` revoke ship in the same
  migration that creates it. `connections` already complies (7.4).
- **AD-2**: `accounts.kind` and the household/shadchanus split the kind checks enforce.

### Dependencies

- **Epic 7 Story 7.4** — hard: owns the `connections` table, its kind trigger
  (`enforce_connection_kinds()`), RLS, grants, the `('accepted','ended')` status vocabulary
  and the live-pair partial unique index. This story ALTERs and adds (three columns + one
  check constraint); it re-creates and re-shapes nothing.
- **Epic 2 Stories 2.1, 2.2** (`current_context_id()`, `accounts.kind`) — hard prerequisite.
- **Epic 2 Stories 2.7/2.8** — pattern precedent only (`get_invite_preview` shape, share-the-
  link UX). Their `invites` machinery stores a raw uuid token and binds roles; it is not
  reused here (see "Why a sibling table").
- **Story 8.1** — the `/connections` placeholder this story's accept flow routes to, and the
  route-manifest mechanics for `/connect/:token`.

### Testing standard

SQL negative-test suite per `.claude/rules/testing.md` and `.claude/rules/security-triggers.md`
(RLS-touching diff ⇒ mandatory negative test). Follow `supabase/tests/references_entity.sql`'s
conventions exactly — do not invent a second test-harness style.

### Project Structure Notes

New: `supabase/tests/shadchan_connections.sql` + `.test.ts`. Schema edits across
`01_tables.sql`, `02_functions.sql`, `05_policies.sql`, `06_grants.sql` (additive to existing
files, consistent with prior epics). No new `src/` folder work beyond what 8.1 started;
Task 6's minimal UI lives in Settings / the Shadchanim list / the `/connect/:token` accept
route until 8.5 formalises it. Also touched: `types.ts` (`Connection`, `ConnectionInvite`),
`providers/supabase/dataProvider.ts` + `providers/fakerest/` (Task 5), and
`providers/commons/englishCrmMessages.ts` / `frenchCrmMessages.ts` (Task 6 copy).
`root/routeManifest.ts` gains the `/connect/:token` custom-route entry.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
