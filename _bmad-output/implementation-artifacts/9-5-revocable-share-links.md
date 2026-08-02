# Story 9.5: Revocable share links

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to send a single's profile to a shadchan by link,
so that sharing is easy but controlled.

## Position in Epic 9

**5th of 5** (`9.1 → 9.2 → 9.3 → 9.4 → 9.5 (this story)`). Unlike 9.1–9.4, this story does not
build on the `listings` table at all — it is a separate mechanism for a different need (FR107:
*"the sole surviving use of tokenised access; the child-portal token surface is deleted"*
[Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.5]).
It can in principle land any time after its own dependencies are met; it is placed last because
it is the largest single build in the epic (a new Cloudflare Worker surface and two new tables)
and benefits from the rest of the epic's schema patterns being settled first.

**Storage ruling (decided, read before Task 4): no Cloudflare R2. The `share/` Worker streams
bytes from Supabase Storage's `documents` bucket** using the service-role key it already holds,
not from an R2 binding. This section and every task below described an R2-backed design in an
earlier draft; that design is superseded, not merely amended, for a concrete reason: R2 is not
enabled on the Cloudflare account (`10042 "Please enable R2 through the Cloudflare Dashboard"`,
confirmed live during the 2026-08-02 token rotation — `.github/workflows/deploy.yml:233-251`),
and no code path in the product uploads resume or photo bytes to R2 at all — every upload
(`resumes.ts`, `resumePhotos.ts`) writes to Supabase Storage's `documents` bucket. This story was
broken as originally written regardless of which storage backend won the argument: it read from
a bucket nothing puts bytes into. Task 4 is the fix, not a deviation from a design that worked.
See Dev Notes "Why Supabase Storage, not R2" for the full reasoning and the trade-off accepted.

**This is the story that finishes what Epic 1 explicitly deferred.** Story 1.4 (Retire the token
portal) says outright: *"the outbound share-link requirement (FR107) is carried by Epic 9, not by
this surface."* This story is that carry-through. It reuses the **pattern** the deleted
child-portal token established (a CSPRNG bearer token, never client-chosen, checked server-side)
but not its mechanism — the portal's token was read from a URL fragment and checked entirely
inside a `SECURITY DEFINER` Postgres RPC reachable by `anon`; this story's token is checked by a
**Cloudflare Worker** using the service-role key, because AD-9 requires every access to be logged
and every file byte to be proxied, which a Postgres RPC alone cannot do (see Dev Notes "Why a
Worker, not another anon RPC").

**Depends on:**
- **Epic 5** Story 5.3 (Resume tab with version history) and Story 5.8 (Single 360) — for a
  single to have their **own** addressable resume record to share, distinct from a suggestion's
  resume. **Verified satisfied in the shipped schema, not a residual gap**: `01_tables.sql:461`
  carries `resumes.single_id bigint`, paired with `resumes_owner_check` (`:462`, the XOR
  `(shidduchim_id is not null) <> (single_id is not null)`) and the partial unique index
  `resumes_single_id_key` (`:1460`, one live resume per single). `providers/supabase/resumes.ts`
  already writes it — `uploadResumeFile` branches on `isSingleSubject(subject)` and uses the
  `single-{id}` storage-path segment. This story's earlier draft carried a fallback task for the
  case Epic 5 had not closed this; strike it (Task 5, rewritten below). One caution, not a task:
  `01_tables.sql`'s own comment on `single_id` (`:456-460`) names it as sitting at the table's
  **physical tail** because `db diff` compares physical column order, and warns the trap "stays
  silent only while nothing depends on `resumes`" — this story is the first to add a real
  dependent (the Worker's manifest builder). If this story ever needs to add a column to
  `resumes` itself (it should not — it only reads), it must append after `single_id`, never
  before it, or `db diff` goes permanently dirty per this repo's known failure mode. Re-run
  `db diff --local` after Task 3 and confirm it is clean/empty for `resumes` specifically.
- **Epic 5** Story 5.4 (Photo tab with explicit visibility) — for the "include photo" choice
  (AC-6) to have a real, explicitly-revealed photo record to point at.
- The existing `workers/share/` scaffold (`index.ts`, `wrangler.toml`, `index.test.ts`) — states
  in its own comment: *"Only the health route exists for now; the proxied stream + revoke/expiry
  checks + `share_access_log` write are future work."* This story is that future work; it does
  not create the Worker, it fills it in. The scaffold's `ShareEnv` currently also declares an
  `MEDIA_BUCKET: R2Bucket` binding and `wrangler.toml` an `[[r2_buckets]]` block — **this story
  removes both** (Task 4) as part of the storage ruling above, not as a separate cleanup.

## Acceptance Criteria

1. **Creating a share link is explicit and scoped to one single.** Given a single I manage, when
   I create a share link, I choose an expiry (a fixed set of durations — Task 6 has the exact
   list) and whether to include the photo; the link is generated only after I confirm.

2. **The token is a forced server-side secret, never client-chosen — at insert and ever after.**
   Given a share-link create request, the `token` column is always overwritten by a database
   trigger with a fresh CSPRNG value (192 bits, hex-encoded) regardless of what a client
   supplies — mirroring `set_child_portal_token_defaults()`'s exact guarantee for the deleted
   portal. Given any subsequent `update` from an `authenticated` client that touches `token`
   (or `single_id`, `include_photo`, `expires_at`), the statement is refused: the only column
   `authenticated` may update is `revoked_at` (column-level grant, Task 2).

3. **The link works for a connected shadchan with no MyShadchan account.** Given a valid,
   unexpired, unrevoked link, when it is opened in any browser, the recipient sees the single's
   opted-in profile snapshot and can download the resume file(s) — with **no** login, no
   `dataProvider`, and **no raw or signed storage URL** (Supabase Storage `createSignedUrl` or
   otherwise) ever appearing in the response (AD-9). Every `downloadUrl` is a same-origin Worker
   path (`/r/:token/file/:fileKey`), never a URL pointing directly at Storage.

4. **The photo is included only if the sharer chose it, at every layer.** Given a share link
   created with `include_photo = false`, the profile response and the file listing never mention
   or link to a photo — not merely hide it client-side. Given `include_photo = true`, the photo
   is served through the same proxied path as the resume files, never a direct or signed storage
   URL.

5. **Every access is logged — every request, not just the first.** Given a valid link, when the
   recipient loads the profile view and separately downloads a file, **two** `share_access_log`
   rows are written (one per request), each with a timestamp; the sharer can see this log against
   their link.

6. **Revocation is immediate, total, and one-way.** Given an active link, when the sharer
   revokes it, the very next request — profile view or file download — is refused, even one
   already in flight with a cached response is not served from that point forward (no caching
   layer sits between the Worker and the check). Given a revoked link, an `update` setting
   `revoked_at` back to `null` is refused by trigger — a recipient-held link never comes back
   to life; re-sharing is a new link.

7. **Expiry is enforced the same way as revocation.** Given a link whose `expires_at` has passed,
   any request against it is refused identically to a revoked one — the response does not
   distinguish "expired" from "revoked" from "never existed" (no oracle for link status, mirroring
   the deleted portal's "unknown or revoked token returns the same null" discipline).

8. **The sharer sees who accessed and when.** Given a share link with access history, the
   sharer's own view (in the app, not the public link) lists each access with its timestamp —
   satisfying AD-9's *"sharer sees who accessed and when."*

9. **Negative tests — cross-account and cross-role.** Given a share link belonging to household
   A, when a member of household B attempts to read, revoke, or view the access log for that
   link through the authenticated app, RLS refuses all three. Given a `helper` or a plain
   `single` in the **same** household, when they attempt to read the share-link list, create a
   link, or revoke one, RLS refuses all three (see Dev Notes "Why share links are
   manager-scoped, not household-scoped" — a `share_links` row carries the bearer token, so
   reading it is holding the key). Given the link's `token`, a member of household B opening the
   public link URL still only ever sees what **any** correctly-tokened recipient would see (the
   token, not household membership, is the credential on that path) — this is expected and is
   not a leak: the design's privacy boundary for this surface is possession of the token,
   exactly like the deleted portal's.
10. **`share_links` and `share_access_log` are never anon-reachable via PostgREST.** Given the
    `anon` role, `select`/`insert`/`update`/`delete` on both tables are all refused — the **only**
    path to this data for an unauthenticated caller is through the `share/` Worker using the
    service-role key, never a direct table or RPC grant to `anon` (this is what keeps AD-1's "the
    only anon-readable relation is `listings`" true even though this story adds two more tables
    that unauthenticated recipients effectively read from).

11. **Deleting a single or a shidduch removes their resume and photo bytes, not just the rows.**
    Given a single (or a shidduch) with an uploaded resume file version and an uploaded photo,
    when that single's/shidduch's record is deleted, every object those rows pointed at in the
    `documents` bucket is removed from Storage, not merely the `resumes`/`resume_photos` rows
    (which the existing `on delete cascade` FK chain already removes at the database). This
    closes a pre-existing gap, not one this story's own storage rework introduces: the purge
    trigger `purge_polymorphic_dependents()` cannot reach the Storage API, and the only
    `beforeDelete` byte-cleanup hook that exists today (`entityFilesCleanupCallbacks`, Story 3.7)
    covers `entity_files` alone — `resumes` and `resume_photos` have no equivalent. Folded into
    this story because it is the storage epic and because this story's own rewrite makes the
    `documents` bucket the *only* byte-cleanup path that matters (see Dev Notes "Byte cleanup for
    resumes and resume_photos").

12. **Cleanup is best-effort and never blocks the delete.** Given the Storage removal call fails
    (a transient Storage API error), the `singles`/`shidduchim` row delete still succeeds and the
    failure is logged, not thrown — mirroring `removeEntityFileObjects`'s existing asymmetry: the
    row delete is authoritative, and a failure to also remove bytes must not leave a record
    undeletable.

13. **`fileKey` is an opaque, server-derived index — never a client-suppliable storage path.**
    Given a valid, unexpired, unrevoked share link, the file manifest's `downloadUrl` entries
    each carry a `fileKey` the Worker itself assigns (e.g. `resume-0`, `photo`) and can
    re-derive, from the token alone, on every subsequent request — the client never supplies or
    influences the underlying storage path. Given a request to `GET /r/:token/file/:fileKey`
    where `fileKey` does not appear in that token's own freshly-rederived manifest (a forged
    value, a path-traversal string, or a real `fileKey` copied from a different share link or
    account), the response is the identical 404 AC-7 requires, and **no** call to
    `.storage.from("documents")` is attempted for it — assert the negative case by asserting the
    mocked storage client is never invoked, not merely by asserting the response shape. This is
    the mitigation the storage ruling requires in exchange for a Worker holding the service-role
    key on the share path: a bug in `fileKey` resolution must not become a path traversal into
    another account's objects.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: `share_links` and `share_access_log`** (AC: 1, 2, 9, 10)
  - [ ] Append to `supabase/schemas/01_tables.sql`:
        ```sql
        create table public.share_links (
            id bigint generated by default as identity primary key,
            account_id bigint not null,
            created_at timestamp with time zone not null default now(),
            single_id bigint not null,
            created_by_member_id bigint references public.account_members(id) on delete set null,
            token text not null,
            include_photo boolean not null default false,
            expires_at timestamp with time zone not null,
            revoked_at timestamp with time zone
        );

        create table public.share_access_log (
            id bigint generated by default as identity primary key,
            share_link_id bigint not null references public.share_links(id) on delete cascade,
            accessed_at timestamp with time zone not null default now(),
            resource text not null,
            ip_hash text,
            user_agent text,
            duration_ms integer
        );
        ```
        `duration_ms` (nullable — the Worker always sets it, but no CHECK forces that) is the
        wall-clock time the request took from token resolution to response, in milliseconds. It
        exists so the storage decision's revisit trigger #2 ("Worker→Storage hop becomes a
        reliability problem, p95 > 1.5s") has an actual data source instead of an anecdote — this
        table is brand new, so adding the column here costs nothing (contrast an `ALTER TABLE`
        on an existing table, which must append at the physical tail per this repo's known
        `db diff` trap — not a concern for a fresh `CREATE TABLE`).
  - [ ] `single_id` carries the domain's standard composite FK, exactly as
        `listings.single_id` does (Story 9.1 Task 1), plus the standard `accounts` FK:
        ```sql
        alter table public.share_links
            add constraint share_links_account_id_fkey
            foreign key (account_id) references public.accounts(id) on delete cascade;
        alter table public.share_links
            add constraint share_links_single_id_fkey
            foreign key (account_id, single_id) references public.singles(account_id, id)
            on delete cascade;
        ```
        The cascade is load-bearing for AD-15: a per-single purge must take every outstanding
        share link (and, via the log's own FK, its access log) down with the single — otherwise
        a purged person's resume stays downloadable through a live link, the exact outcome a
        data-subject removal exists to prevent. `share_access_log.share_link_id` keeps its plain
        FK to `share_links` with cascade (Dev Notes "Does revoking delete the log" explains why
        *revoke* never deletes, but a purge-driven hard delete correctly does).
  - [ ] `resource` on `share_access_log` records **what** was accessed on that request (e.g.
        `"profile"`, `"resume:<file-key>"`, `"photo"`) — AC-5 requires every request logged, not
        only "the link was opened once," so the log needs to distinguish a profile view from a
        file download.
  - [ ] Indexes: `create index share_links_account_id_idx on public.share_links using btree
        (account_id);` `create unique index share_links_token_key on public.share_links
        (token);` `create index share_access_log_share_link_id_idx on public.share_access_log
        using btree (share_link_id);`
  - [ ] Trigger for `token`, mirroring `set_child_portal_token_defaults()` exactly (the deleted
        function is the direct precedent — read it before writing this one, it is still in git
        history / this document's citation):
        ```sql
        create or replace function public.set_share_link_token_defaults()
            returns trigger
            language plpgsql
            set search_path = ''
        as $$
        begin
          if new.account_id is null then
            new.account_id := public.current_context_id();
          end if;
          new.token := encode(extensions.gen_random_bytes(24), 'hex');
          return new;
        end;
        $$;

        create or replace trigger set_share_link_token_defaults
            before insert on public.share_links
            for each row execute function public.set_share_link_token_defaults();
        ```
        INSERT-only, never re-run on an update — revoking a link must not silently rotate its
        token (same guarantee the deleted portal made).
  - [ ] A second, `BEFORE UPDATE` trigger makes revocation one-way (AC-6):
        ```sql
        create or replace function public.enforce_share_link_revoke_once()
            returns trigger
            language plpgsql
            set search_path = ''
        as $$
        begin
          if old.revoked_at is not null
             and new.revoked_at is distinct from old.revoked_at then
            raise exception 'a revoked share link cannot be un-revoked';
          end if;
          return new;
        end;
        $$;

        create or replace trigger enforce_share_link_revoke_once
            before update on public.share_links
            for each row execute function public.enforce_share_link_revoke_once();
        ```
        Plain `SECURITY INVOKER` — it only ever blocks, never needs privilege. Together with
        Task 2's `update (revoked_at)`-only column grant, the whole client-side update surface
        of a share link is: `null → now()`, once.

- [ ] **Task 2 — RLS: manager-side management, zero `anon` reach** (AC: 9, 10)
  - [ ] `alter table public.share_links enable row level security;` `force row level security;`
        (AD-1 requires `FORCE` on every table without exception, including one whose "real"
        readers are outside Postgres entirely).
  - [ ] `"Share links manager scoped"` — one `for all to authenticated` policy whose `using`
        **and** `with check` both require, with explicit parentheses (the 9.3 Task 4 precedence
        lesson applies here too):
        ```sql
        account_id = public.current_context_id()
        and (
          exists (
            select 1 from public.account_members am
            where am.account_id = public.current_context_id()
              and am.user_id = auth.uid() and am.role = 'parent_admin'
          )
          or exists (
            select 1 from public.account_members am
              join public.singles s on s.member_id = am.id
            where am.account_id = public.current_context_id()
              and am.user_id = auth.uid()
              and am.role = 'self_manager' and s.id = share_links.single_id
          )
        )
        ```
        — the same manager predicate as 9.2's publish policy, **not** the domain's usual blanket
        account scope. See Dev Notes "Why share links are manager-scoped, not household-scoped";
        creating, listing, and revoking (revoke is an `update … set revoked_at = now()`, not a
        delete — see Dev Notes) all go through this one policy.
  - [ ] `alter table public.share_access_log enable row level security;` `force row level
        security;` `"Share access log readable by link owner"` — `for select to authenticated
        using (exists (select 1 from public.share_links sl where sl.id =
        share_access_log.share_link_id and sl.account_id = public.current_context_id()))` — the
        subquery runs under `share_links`' own RLS, so the manager scoping narrows this too. No
        `insert`/`update`/`delete` policy for `authenticated` at all — the **only** writer of
        this table is the `share/` Worker, using the service-role key, which bypasses RLS
        entirely (AD-7). Do not grant `authenticated` any DML on this table.
  - [ ] `revoke all on table public.share_links, public.share_access_log from anon;` — no
        `grant … to anon` line at all, on either table, ever (AC-10). `grant select, insert on
        table public.share_links to authenticated;` plus `grant update (revoked_at) on table
        public.share_links to authenticated;` — **column-level, `revoked_at` only, and no
        table-level `update` grant ever issued** (a table-level grant would override the column
        restriction and let any member rewrite `token` — AC-2's "never client-chosen" must hold
        for updates too). No `delete` (see Dev Notes "Does revoking delete the log" — revocation
        is an update). `grant all on table public.share_links, public.share_access_log to
        service_role;` Corresponding sequence grants, `anon` excluded, same pattern as 9.1
        Task 3.

- [ ] **Task 3 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_share_links`
  - [ ] Hand-check: confirm `FORCE ROW LEVEL SECURITY` on both tables, confirm no `anon` grant
        line was emitted on either (check against the fork's lingering `alter default privileges
        … grant all on tables to anon`, exactly as flagged in Story 9.1 Task 3), confirm the
        token trigger is `before insert` only (not `before insert or update`), confirm
        `share_access_log.duration_ms` is present.
  - [ ] Run `db diff --local` a second time, scoped to `resumes` — it must be **empty**. This is
        the check named in "Depends on" above: this story is the first to add a real dependent on
        `resumes.single_id`, and that column sits at the table's physical tail on purpose. An
        empty diff here confirms nothing in this story accidentally touched `resumes`' column
        order.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`,
        never `db push`.

- [ ] **Task 4 — The `share/` Worker: fill in the scaffold, on Supabase Storage** (AC: 3, 4, 5,
      6, 7, 10, 13)
  - [ ] **Drop the R2 binding.** `workers/share/index.ts` currently declares `ShareEnv extends
        BaseEnv { MEDIA_BUCKET: R2Bucket }` — change it to a plain `BaseEnv` (no additional
        field). `workers/share/wrangler.toml:6-11` currently declares:
        ```toml
        # AD-9: the only Worker with an R2 binding. `bucket_name` is illustrative —
        # create the actual bucket (`npx wrangler r2 bucket create myshadchan-media`)
        # and adjust the name here if you choose a different one.
        [[r2_buckets]]
        binding = "MEDIA_BUCKET"
        bucket_name = "myshadchan-media"
        ```
        Delete this whole block (comment included) — nothing in `wrangler.toml` replaces it; the
        Worker reaches Storage through the ordinary `@supabase/supabase-js` client it already
        gets `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for (`workers/shared/env.ts:4-7`,
        pushed to `share` per its own `wrangler.toml`).
  - [ ] Extend the same `Hono` app (do not create a parallel one). Add:
        - `GET /r/:token` — looks up `share_links` by token **using the service-role client
          directly** (not `forAccount()`, since the account is not known until the token
          resolves it — the token itself is the trusted root here, the same role a verified
          invite token plays per AD-7). If missing, revoked, or expired: identical `404`
          response in all three cases (AC-7's no-oracle rule). Otherwise: write one
          `share_access_log` row (`resource: "profile"`, `duration_ms` = elapsed time from the
          start of the request to just before responding), then read the single's opted-in
          profile fields via `forAccount(shareLink.account_id, env)` and build the file manifest
          (see Task 5 — the dependency is confirmed satisfied) and respond with the standard
          `{ success, data }` envelope [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md
          — Worker API convention]. **The manifest is the opaque-`fileKey` boundary (AC-13):**
          build it as an array the Worker itself indexes (e.g. `resume-0`, `resume-1` for
          successive `resumes.files[]` entries, `photo` for the one `resume_photos` row when
          `include_photo` is true) mapped internally to each entry's real `path` — never expose
          the real Storage path to the client. Each entry's `downloadUrl` is
          `/r/:token/file/:fileKey`, never a raw or signed Storage URL, and the photo entry is
          omitted entirely when `include_photo` is false.
        - `GET /r/:token/file/:fileKey` — re-validates revoke/expiry (AC-6/7 apply to **every**
          request, including this one — do not cache the first check's result across requests),
          **re-derives the same manifest fresh** (do not trust a manifest built on an earlier
          request or reuse the profile handler's in-memory result across requests), and looks
          `fileKey` up in **that** freshly-built manifest. If `fileKey` is not a member of it —
          forged, path-traversal, or a real key copied from a different link/account — respond
          with the identical 404 (AC-13) **without** calling `.storage.from(...)` at all.
          Otherwise: write another `share_access_log` row (`resource: "resume:<fileKey>"` or
          `"photo"`, `duration_ms` measured around the storage call), then call
          `getSupabaseClient(serviceRole).storage.from("documents").download(resolvedPath)` and
          stream the returned `Blob`'s bytes through the Worker's own response — never a redirect
          to Storage, never `createSignedUrl` (AD-9's "recipients never get a raw or pre-signed
          URL" rule, now stricter: there is no signed-URL call anywhere on this path). The
          storage read itself is **not** run through `forAccount()` — `ScopedClient` (Task 4's
          existing precedent below) only wraps Postgres `.from(table)`, not `.storage`; use a
          plain service-role Supabase client for the download call, which is the accepted
          trade-off named in the storage ruling (RLS never applies to this path either way).
  - [ ] Use `forAccount(shareLink.account_id, env)` (existing `workers/shared/forAccount.ts`) for
        every **tenant-table** read (singles, resumes, resume_photos) **once the account is known
        from the resolved token** — do not query tenant tables with the raw service-role client
        beyond the initial `share_links` lookup; that lookup is the one place AD-7's "trusted
        root" derivation happens, everything downstream of it goes through the scoped client
        like every other Worker. (Storage reads are the one exception, immediately above.)
  - [ ] `workers/share/index.test.ts` already tests `/health` — extend it, do not replace it.
        Cover: valid token → 200 + envelope; unknown/revoked/expired token → identical 404 for
        all three (assert byte-for-byte identical body, not just the same status code); revoked
        mid-session → the very next request after revoke fails (simulate by revoking between two
        calls in the same test); `include_photo = false` → no photo entry in the manifest;
        two requests → two `share_access_log` rows with distinct `resource` values and a
        non-null `duration_ms` on each; **and the AC-13 negative test** — a forged/traversal
        `fileKey`, and separately a real `fileKey` value taken from a *different* share link's
        manifest, both return the identical 404 and neither causes the mocked
        `.storage.from("documents")` client to be invoked.
  - [ ] **Amend the architecture spine in the same diff** (do not leave the written spine
        contradicting the shipped code): in
        `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`,
        AD-9's rule text (`:101`, "all user files (resumes, photos) in **R2**") becomes "in
        **Supabase Storage's `documents` bucket**" — the proxy-and-log requirement itself
        (Worker-proxied stream, revoke/expiry checked every request, `share_access_log` on every
        request, no raw/pre-signed URL to the recipient) is unchanged and remains fully binding,
        only the storage vendor named changes. AD-15's rule text (`:131`, "cascades to R2
        objects") becomes "cascades to Storage objects". The Stack table's Media row (`:218`,
        "✅ **Cloudflare R2** (zero egress)") and the Structural Seed mermaid diagram's `R2` node
        (`:239`) are updated the same way. Verify these by content match, not line number alone —
        the file may have moved since this pass read it.

- [ ] **Task 5 — Epic 5's resume shape (confirmed satisfied — read this before writing Worker
      queries anyway)** (AC: 3)
  - [ ] **Verified, not assumed.** `public.resumes` already has a single's own addressable
        resume: `01_tables.sql:461` carries `single_id bigint` alongside `shidduchim_id`
        (`:452`, now nullable), with `resumes_owner_check` (`:462`) enforcing exactly one of the
        two is set, and the partial unique index `resumes_single_id_key` (`:1460`) guaranteeing
        at most one live resume per single. `providers/supabase/resumes.ts#uploadResumeFile`
        already branches on `isSingleSubject(subject)` and writes the `single-{id}` storage-path
        segment. **There is no fallback branch to build here** — an earlier draft of this task
        carried one for the case Epic 5 had not shipped this yet; it has, so query `resumes`
        filtered on `single_id = <the share link's single>` directly for the file manifest, the
        same way `resumes.ts` and `resumePhotos.ts` already address a single's own resume/photo.
  - [ ] The photo source is `resume_photos`, filtered by `resume_id` (the resume row found
        above) — Epic 5 Story 5.4 shipped this already (`resumePhotos.ts`, table
        `public.resume_photos`). Do not build a second, parallel photo-storage path here. Story
        5.4 has also already shipped (`resume_photos` exists with `visibility`/`hidden_at`,
        `resumePhotos.ts` implements upload/sign/hide) — the `include_photo` toggle (Task 6) has
        a real record to point at from day one; the earlier disabled-toggle fallback for "if 5.4
        has not landed" does not apply. Note this is the **only** Epic-9 surface that ever
        carries a photo — listings never do (9.1 Dev Notes "No photo on a listing"); a share link
        can, precisely because it has the logged, revocable, expiring proxy AD-9 demands. Exclude
        a photo whose `hidden_at is not null` from the manifest regardless of `include_photo`
        (a soft-hidden photo is never re-surfaced through a share link either).

- [ ] **Task 6 — Provider and components** (AC: 1, 6, 8)
  - [ ] `providers/supabase/dataProvider.ts`: plain `dataProvider.create("share_links", { data:
        { single_id, expires_at, include_photo } })` / `dataProvider.getList("share_links", …)`
        for the sharer's own list. **Revoke is a custom method `revokeShareLink(id)`** issuing
        `update({ revoked_at: <now> })` on that one column only — not a generic
        `dataProvider.update`, because the generic path sends every field of the record and
        would be refused by Task 2's `revoked_at`-only column grant; and not a delete (Dev Notes
        "Does revoking delete the log"). Add a `getShareAccessLog(shareLinkId)` custom method
        reading `share_access_log` (AC-8). Both follow `createShidduchViaRpc`'s thin-wrapper
        shape.
  - [ ] `providers/fakerest/`: add `share_links` and `share_access_log` base resources; since
        FakeRest has no triggers, emulate the CSPRNG-token-on-create behavior in
        `internal/shareLinks.ts` (same "hand-written twin of a Postgres-only behavior" pattern as
        Story 9.3's `internal/listingWithdrawal.ts`). FakeRest cannot emulate the Worker's proxy
        stream — its `share/` surface is exercised only by the Worker's own Vitest suite (Task 4),
        not through the FakeRest demo build; say this explicitly in the FakeRest file's own
        comment so a future contributor does not go looking for it there.
  - [ ] New directory `src/components/atomic-crm/sharing/` — named exactly as the architecture
        spine's own planned source tree already lists it
        (`_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`
        §"Source tree (new work in bold)": *"`resumes/ references/
        dates/ inbox/`, `reminders/ sharing/ candidate-portal/`"*). `sharing/CreateShareLinkDialog.tsx`
        (AC-1: expiry choice — 7/30/90 days, a fixed set rather than a free datetime picker, kept
        simple deliberately; `include_photo` checkbox), `sharing/ShareLinkList.tsx` (per-single
        list of active/expired/revoked links with a revoke action and the access-log view, AC-8),
        `sharing/shareToken.ts` (mirrors `portal/portalToken.ts`: `SHARE_PATH = "/share"`,
        `isShareUrl`, `readShareToken` — **fragment-only**, unlike Story 9.4's `/find`, because
        this token *is* a bearer secret, exactly like the deleted portal's — see Dev Notes "Why
        this token is fragment-only and 9.4's query isn't"), `sharing/shareClient.ts` (calls the
        Worker's `GET /r/:token` via `fetch`, mirroring `portal/portalClient.ts`'s shape),
        `sharing/SharedProfilePage.tsx` (the recipient-facing page, mirroring
        `ChildPortalPage.tsx`'s unauthenticated-shell pattern), `sharing/sharedProfileTranslate.ts`
        (see the i18n bullet below).
  - [ ] **i18n, two different seams in one story.** `CreateShareLinkDialog.tsx` and
        `ShareLinkList.tsx` render inside Settings (inside `<Admin>`), so the ordinary
        `useTranslate()` seam applies. `SharedProfilePage.tsx` renders outside `<Admin>` — the
        recipient has no session — so it needs the same `landingTranslate.ts`-style direct
        `i18nProvider.translate()` call 9.4's `PublicSearchPage.tsx` uses, not `useTranslate()`
        (see 9.4's own Dev Notes for the pattern). Every new string in either surface still gets
        a key in **both** `providers/commons/englishCrmMessages.ts` and
        `providers/commons/frenchCrmMessages.ts` in the same diff (C7).
  - [ ] `src/App.tsx`: add the `isShareUrl(window.location)` check before `<LandingGate>`,
        alongside the `/find` check this epic's Story 9.4 already added — both are pre-CRM
        routes now; keep them as separate, clearly named early-returns rather than merging into
        one generic "public route" branch, since their token handling (fragment vs. query) and
        data source (Worker fetch vs. direct Supabase client) are genuinely different.
  - [ ] Where the sharer reaches this from: Settings, next to Story 9.2's
        `settings/SingleListingSection.tsx` — a "Share" action per single, opening
        `CreateShareLinkDialog`. Same rationale as 9.2 Task 5 for not putting this on the Single
        360's tab bar (Epic 5 Story 5.8 does not list it).
  - [ ] **`registry.json`** — this story adds the whole `sharing/` directory; regenerate with
        `make registry-gen` (or the pre-commit hook) and declare the file as touched.
  - [ ] **`share` rejoins the `deploy-workers` matrix.** `.github/workflows/deploy.yml:275`
        currently reads `worker: [ingest, parse, match, ai, cron]` — add `share` to that list.
        The withholding comment at `:233-250` explains why it was withheld (the R2-binding
        `wrangler deploy` failure) and its own last line already names the unlock: *"Re-add once
        R2 is enabled on the account and `wrangler r2 bucket create myshadchan-media` is
        confirmed run (**or the binding is dropped**)."* This story drops the binding (Task 4),
        so update that comment block to say so — do not leave it describing a design this story
        just replaced. No other change to the job is needed: `share`'s `wrangler.toml` already
        declares `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` as secrets pushed the same way every
        other worker's are.

- [ ] **Task 7 — Byte cleanup for `resumes` and `resume_photos`** (AC: 11, 12)
  - [ ] `providers/supabase/resumes.ts`: add `removeResumeFileObjects(paths: string[]):
        Promise<void>`, mirroring `entityFiles.ts#removeEntityFileObjects` exactly — no-op on an
        empty array, `getSupabaseClient().storage.from("documents").remove(paths)`, error
        logged via `console.error`, never thrown.
  - [ ] `providers/supabase/resumePhotos.ts`: add `removeResumePhotoObjects(paths: string[]):
        Promise<void>`, same shape, for `resume_photos.path` values.
  - [ ] New `providers/supabase/resumeStorageCleanup.ts` (own file, following `entityFiles.ts`'s
        own convention of building the callback array in the module that owns the data, not
        inline in `dataProvider.ts` — review-fix F5 precedent, unit-testable independent of the
        whole custom-methods overlay): `buildResumeStorageCleanupCallbacks(): ResourceCallbacks[]`
        returning one `beforeDelete` entry for resource `"singles"` and one for `"shidduchim"`.
        Each entry, given the parent's `params.id`: `dataProvider.getList<Resume>("resumes", {
        filter: { single_id: params.id } | { shidduchim_id: params.id }, pagination: { page: 1,
        perPage: 1 }, ... })` (at most one row, per `resumes_single_id_key` /
        `resumes_shidduchim_id_key`); if a row exists, call `removeResumeFileObjects` with every
        `files[].path`, then `dataProvider.getList<ResumePhoto>("resume_photos", { filter: {
        resume_id: resume.id }, pagination: { page: 1, perPage: 10_000 }, ... })` and call
        `removeResumePhotoObjects` with every `path`. Return `params` unchanged either way — a
        storage failure is logged inside the two remove functions, never re-thrown here (AC-12).
  - [ ] `dataProvider.ts`: splice `...buildResumeStorageCleanupCallbacks()` into
        `lifeCycleCallbacks` alongside the existing `...entityFilesCleanupCallbacks` spread, and
        export the built array the same way `entityFilesCleanupCallbacks` is exported (review-fix
        F2 precedent) so `dataProvider.test.ts` exercises the exact array that ships, not a
        re-implementation.

- [ ] **Task 8 — Tests** (AC: all)
  - [ ] `resumeStorageCleanup.test.ts` — deleting a `singles` row (and separately a `shidduchim`
        row) with a resume carrying multiple `files[]` versions and one `resume_photos` row
        calls `.storage.from("documents").remove([...])` with every one of those paths, using a
        mocked Supabase client (mirror `entityFiles.test.ts`'s shape); and the parent row's
        delete still resolves when the mocked `.remove()` call rejects (AC-12) — assert no
        exception propagates out of the `beforeDelete` hook.
  - [ ] `supabase/tests/share_links.sql` + `.test.ts` — new database suite, same harness as
        `billing_entitlement.sql`. Checks: AC-2, both halves (token is always CSPRNG-overwritten
        regardless of client-supplied value at insert; an `authenticated` `update` touching
        `token` is refused — plus `has_column_privilege('authenticated', 'public.share_links',
        'token', 'UPDATE')` false and the same for `single_id`/`include_photo`/`expires_at`),
        AC-6's one-way half (un-revoking raises), AC-9 (cross-account refused on all of
        select/update against `share_links`, and select against `share_access_log`; **and**
        same-household `helper` and plain-`single` roles refused select/insert/update, plus a
        `self_manager` refused for a sibling's `single_id`), AC-10
        (`has_table_privilege('anon', 'public.share_links', 'SELECT')` etc. all false, on both
        tables — the direct counterpart to the deleted `child_portal.sql`'s "anon has NO
        privilege on `child_portal_tokens`" checks; that file is gone by the time this story
        runs, read it from git history).
  - [ ] `workers/share/index.test.ts` — the full list under Task 4's last bullet.
  - [ ] Frontend component tests for `CreateShareLinkDialog`, `ShareLinkList` (revoke action,
        access-log rendering), `SharedProfilePage` (loading/inactive/active states, mirroring
        `ChildPortalPage.test.tsx`'s three-state shape), and the two new `App.tsx` branches.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db` (the SQL suite) —
        `make test` already covers `workers/**/*.test.ts` via `test:unit:workers`
        [Source: vitest.config.ts `workers` project; makefile `test-workers` target], so the
        Worker tests need no separate
        invocation, unlike the database suite. Plus `npx prettier --check` on this story's
        changed files only.

## Dev Notes

### Why a Worker, not another anon RPC (the deleted portal's mechanism, deliberately not reused)

The deleted child portal proved that a single `SECURITY DEFINER` RPC granted to `anon` can safely
serve unauthenticated reads when its own scoping is airtight. This story does not reuse that
shape, for two concrete reasons AD-9 states directly: (1) **file bytes**. The portal only ever
returned JSON; this story must serve actual resume/photo file content, and AD-9 requires that be
a **proxied stream**, which is an HTTP-body concern a Postgres function cannot perform — it has
to be a runtime that can hold a storage client and stream a response, which is what a Worker is
for (AD-7's "compute home"). This reasoning is unchanged by the storage-backend decision below —
it is about *compute*, not about which storage vendor holds the bytes. (2) **AD-1's tightened
anon surface.** By the time this story runs, AD-1's rule is that `listings` is *"the only
anon-readable relation in the product"* — adding a second `anon`-grantable RPC here, however
tightly scoped, would make that sentence false. Routing through a Worker using the service-role
key keeps the *Postgres* anon-surface exactly one relation wide, while still serving the
unauthenticated recipient at the HTTP layer.

### Why Supabase Storage, not R2

An earlier draft of this story built the Worker against a Cloudflare R2 binding, matching AD-9's
original text. That design cannot ship: R2 is not enabled on the Cloudflare account (`10042
"Please enable R2 through the Cloudflare Dashboard"`, confirmed live during the 2026-08-02 token
rotation — see `.github/workflows/deploy.yml:233-250`), and separately, no code anywhere in the
product ever uploads a resume or photo byte to R2 — every upload (`resumes.ts`,
`resumePhotos.ts`) writes to Supabase Storage's `documents` bucket. Even with R2 enabled, this
story's Worker would have been reading from an empty bucket while the real bytes sat somewhere
else. The fix is to point the Worker at where the bytes actually are.

**The trade-off, named plainly.** For the share path specifically, the two backends are
*authorization-equivalent*: a Worker holding the service-role key bypasses RLS/storage-policy
enforcement either way, so neither design gives this path an RLS backstop — the Worker's own
code is the enforcement point regardless of vendor. What changes is blast radius: R2 with
share-only copies would have capped a bug in this Worker's key-derivation to "files someone
already chose to share"; reading live from `documents` means a bug here can in principle reach
every object in every account, because the service-role key that reads the share target is the
same key that reads everything else. This is accepted, not overlooked, and it is why AC-13 (the
opaque, server-derived `fileKey`, never a client-supplied path) is a hard requirement here and
not a nice-to-have: it is the mitigation this story owes in exchange for the concession. Every
other file-access path in the product — every resume view, every photo reveal in the
authenticated app — is completely unaffected: it still goes through Postgres/Storage RLS,
twelve mutation-proven policies, untouched by this decision, because primary storage never
moves. Only the one already-Worker-mediated share path changes vendor.

**AD-9's proxy-and-log requirement is fully satisfied, and arguably strengthened**, by staying
on Supabase Storage: served only by the `share/` Worker as a proxied stream (the Worker reads
the bytes and pipes them into its own response); `revoked_at`/`expires_at` checked on every
request (AC-6/7, Task 4); `share_access_log` written on every request (AC-5); recipients never
receive a raw or pre-signed URL — and this is the strengthened part, since there is now no
`createSignedUrl` call anywhere on the share path at all, only the opaque `fileKey` manifest
(AC-13). The only clause of AD-9 that changes is the storage vendor named in its text, which
Task 4's spine-amendment bullet updates in the same diff — this project's own culture is that
the written spine says what is true, not what a decision changed underneath it.

### Why this token is fragment-only and 9.4's query isn't

This token is a **bearer secret** — anyone holding it gets access, so it must never be sent
anywhere passively (Vercel access logs, a Referer header on an embedded resource, browser
history sync to a second device). The URL fragment (`/share#<token>`) is never sent to any server
by the browser automatically — exactly the guarantee `portal/portalToken.ts`'s doc comment
states for the deleted portal, word for word applicable here. The client's own deliberate
`fetch()` call to the Worker *does* send the token (as a path segment) — that is the intended,
one-time, code-initiated reveal, not a passive leak, and mirrors exactly how the portal's
fragment-sourced token was deliberately passed to `get_child_portal(p_token)` as an RPC argument.
Story 9.4's search query, by contrast, is not a secret — it is meant to be shared, bookmarked,
and reconstructed from a plain link, so it belongs in the query string, not the fragment. Do not
harmonize the two; they solve different problems.

### Does revoking delete the log

No. `share_access_log` rows are kept after a link is revoked (or expires) — a sharer reviewing
"who accessed this before I revoked it" (AC-8) needs that history to survive the revoke. This is
why revocation is `update … set revoked_at = now()` (Task 2), not a `delete` on `share_links` —
a hard delete would cascade and destroy the very audit trail AD-9 promises the sharer. `delete` is
therefore deliberately **not** granted to `authenticated` on `share_links` at all (Task 2) — there
is no product path that ever needs to hard-delete a share link.

### Why share links are manager-scoped, not household-scoped

The domain's blanket "scoped to account" `for all` policy would be a privilege escalation here,
for a reason unique to this table: **a `share_links` row contains the bearer token, and the
Worker serves the files to whoever presents it using the service-role key** — not the reader's
own rights. A `helper` (who "sees less than parents", AD-3) or a plain `single` who could
`select` this table, or mint a row of their own, could open `/r/:token` themselves and read
resume/photo bytes their role is denied everywhere else. So creation, listing, and revocation
are restricted to the same two roles FR103 trusts to publish: `parent_admin` (any single in the
household) and `self_manager` (their own record only). One open question is deliberately
**flagged, not resolved**: whether a plain `single` with a login should *see or revoke* links
about themselves (a FR104-style dignity extension) — that widening needs its own story with its
own token-exposure treatment (e.g. a token-less view), not a quiet policy tweak here.

### Dependency on Epic 5's resume shape — verified satisfied, not flagged

An earlier draft of this story flagged this as an unstated cross-epic dependency and gave a
fallback in case Epic 5 had not shipped a single's own addressable resume by the time Epic 9
started. It has: `resumes.single_id` + `resumes_owner_check` + `resumes_single_id_key` are all
live in the shipped schema (Task 5), and `resumePhotos.ts`/`resume_photos` cover the photo half.
The dependency is real and worth recording in `epics.md` for future readers regardless (an
explicit "9.5 depends on 5.3/5.4/5.8" line costs nothing and documents why this story could not
have shipped earlier), but it is not blocking this story and Task 5 no longer carries a
fallback branch.

### Byte cleanup for resumes and resume_photos (AC-11, AC-12)

This story's own rewrite (Task 4) makes the `documents` bucket the *only* place resume/photo
bytes are ever served from, on every path — in-app and shared — which is exactly why the
existing gap in row-vs-byte lifecycle now matters more than it did before this story: deleting a
`singles` or `shidduchim` row cascades to delete its `resumes`/`resume_photos` rows at the
database (the FKs are `on delete cascade`), but `purge_polymorphic_dependents()` — the trigger
that runs the polymorphic side of a purge — is SQL and cannot call the Storage API, so the
bytes those rows pointed at are never removed. The only precedent for closing this kind of gap,
`entityFilesCleanupCallbacks` (Story 3.7), covers `entity_files` alone. Task 7 adds the
`resumes`/`resume_photos` equivalent, keyed to `beforeDelete` on `"singles"` and `"shidduchim"`
(the only two resource deletes that can ever orphan a resume or photo), following the exact
same shape: read the still-present child rows before the delete request reaches the server,
remove their storage objects, log rather than throw on failure. This is a pre-existing product
gap, not something this story's storage rework introduces — it is fixed here because Epic 9 is
named the storage epic and because leaving it open next to a rewritten, storage-vendor-honest
share path would be an inconsistent level of care for the same bucket.

### Security / RLS

New Worker surface with a service-role key, two new tables, Supabase Storage access, and
unauthenticated file serving — `.claude/rules/security-triggers.md`'s triggers ("external API
calls," "file system operations," "user input handling") all apply at once. AC-9 and AC-10 are
the required negative tests for the tables; **AC-13's forged-`fileKey` negative test is the
required one for the storage rework** — a Worker holding the service-role key on this path
means `fileKey` resolution is the only thing standing between a valid token and another
account's resume, so that test is not optional coverage, it is the boundary. The single
highest-value review point: confirm `GET /r/:token/file/:fileKey` re-checks
`revoked_at`/`expires_at` **and rebuilds the manifest fresh** on **every** call rather than
trusting a check (or a manifest) computed by `GET /r/:token` earlier in the same session —
AC-6/7 are worded "every request" specifically to
rule out a cached-authorization shortcut. One acknowledged gap that is not this story's:
AD-17 names rate limiting on share-link access (anti-scraping), and no story in Epics 1–11
owns AD-17 anywhere — this story's own mitigations are the 192-bit token and the uniform 404;
the rate limit itself is flagged to the epic owner, not silently absorbed here.

### Migration workflow

Same as every other story in this epic: schema-first, `DBUS_SESSION_BUS_ADDRESS=/dev/null` on
every `npx supabase` call, never `db reset`/`db push`
[Source: AGENTS.md#Database-Management, memory/supabase-cli-dbus-hang.md].

### Testing standards

`supabase/tests/share_links.sql` runs only under `npm run test:unit:db`, outside `make test`
[Source: vitest.config.ts `db` project; makefile `test-unit` target]. `workers/**/*.test.ts`
**is** covered by `make test` via `test:unit:workers` [Source: vitest.config.ts `workers`
project; makefile `test-workers` target] — do not report this story done
citing only `make test` for the database half, but do treat `make test` as sufficient for the
Worker half. AAA structure, ≥80% coverage on new paths, negative tests exercise the real client-
facing boundary [Source: .claude/rules/testing.md, .claude/rules/security-triggers.md].

### Project Structure Notes

- New tables appended to `01_tables.sql`; new policies/grants appended to the relevant sections
  of `05_policies.sql`/`06_grants.sql` — no new schema files.
- New component directory `src/components/atomic-crm/sharing/`, matching the architecture
  spine's own named source-tree entry (cited above) — do not fold this into `listings/`, they are
  functionally distinct (opt-in public discovery vs. targeted revocable private sharing).
- `workers/share/index.ts` and `index.test.ts` are **extended**, not replaced — the existing
  `createWorkerApp("share")` scaffold and its `/health` route stay exactly as they are; `ShareEnv`
  itself is narrowed from `BaseEnv & { MEDIA_BUCKET: R2Bucket }` to plain `BaseEnv` (Task 4).
  `workers/share/wrangler.toml` loses its `[[r2_buckets]]` block.
- **`providers/supabase/resumes.ts`, `providers/supabase/resumePhotos.ts`** — each gains one
  small export (Task 7); **new** `providers/supabase/resumeStorageCleanup.ts`;
  `providers/supabase/dataProvider.ts` gains one new spread into `lifeCycleCallbacks`.
- **`.github/workflows/deploy.yml`** — `share` added to the `deploy-workers` matrix and its
  withholding comment corrected (Task 6).
- **`_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`**
  — AD-9, AD-15, the Stack table's Media row, and the Structural Seed diagram all get the
  R2 → Supabase Storage wording amendment (Task 4).
- **`registry.json`** — the new `sharing/` directory; regenerate with `make registry-gen`.
- **Both i18n catalogues** (`providers/commons/englishCrmMessages.ts`,
  `providers/commons/frenchCrmMessages.ts`) — every new string across `sharing/`'s two i18n
  seams (Task 6).
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.5-Revocable-share-links]
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.5] — FR107, and its note that this is "the sole surviving use of tokenised access"
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9] — proxied-stream rule, access logging, no raw/pre-signed URLs, revoke=immediate (amended by this story to name Supabase Storage, not R2 — Task 4)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-15] — data-lifecycle cascade rule, also amended (Task 4) and directly related to AC-11/AC-12's byte cleanup
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-7] — `forAccount()` scoped client, trusted-root derivation
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1] — the "sole anon-readable relation" constraint this story must not violate
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/SOLUTION-DESIGN.md §4] — `share_links`/`share_access_log` named in the data model
- [Source: workers/share/index.ts, wrangler.toml, index.test.ts] — the existing scaffold this story fills in and narrows (R2 binding removed)
- [Source: workers/shared/forAccount.ts, createApp.ts, envelope.ts] — the Worker conventions this story must reuse, not reinvent
- [Source: .github/workflows/deploy.yml:233-251,275] — the `share` exclusion and its own stated unlock condition ("or the binding is dropped"), which this story satisfies
- [Source: supabase/schemas/02_functions.sql — `set_child_portal_token_defaults()`, `get_child_portal()`] — the CSPRNG-token and no-oracle precedents (both deleted by Epic 1 Story 1.4, cited here from the pre-deletion codebase this documentation pass read)
- [Source: supabase/schemas/01_tables.sql:452,456-462,1459-1460] — `resumes.single_id`, `resumes_owner_check`, `resumes_single_id_key`: the Epic 5 dependency, verified shipped, not assumed
- [Source: src/components/atomic-crm/providers/supabase/entityFiles.ts#buildEntityFilesCleanupCallbacks] — the byte-cleanup pattern Task 7's `resumeStorageCleanup.ts` follows
- [Source: 1-4-retire-token-portal.md] — confirms the portal is gone and explicitly hands FR107 to this epic
- [Source: 9-1-publish-shadchan-listing.md] — the composite `(account_id, single_id)` FK precedent (`listings_single_id_fkey`) this story repeats, and Dev Notes "No photo on a listing" (why a share link is the only Epic-9 photo surface)
- [Source: 9-4-public-search.md, src/components/atomic-crm/landing/landingTranslate.ts] — the i18n-outside-`<Admin>` pattern `SharedProfilePage.tsx` follows
- [Source: .claude/rules/security-triggers.md] — review triggers for external calls, file ops, user input
- [Source: AGENTS.md#Database-Management] — migration workflow

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
