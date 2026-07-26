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
[Source: amendment-a2.md#A2.5]). It can in principle land any time after its own dependencies are
met; it is placed last because it is the largest single build in the epic (a new Cloudflare
Worker surface, two new tables, R2 wiring) and benefits from the rest of the epic's schema
patterns being settled first.

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
  resume. Today's schema only has `resumes.shidduchim_id` (1:1 with a *shidduch*, i.e. a
  suggestion) — there is no column that keys a resume to a *single* directly. **This is a real
  gap the epic list does not currently state** — see Dev Notes "Dependency on Epic 5's resume
  shape" for the fallback this story takes if Epic 5 has not closed it by the time 9.5 starts.
- **Epic 5** Story 5.4 (Photo tab with explicit visibility) — for the "include photo" choice
  (AC-6) to have a real, explicitly-revealed photo record to point at.
- The existing `workers/share/` scaffold (`index.ts`, `wrangler.toml`, `index.test.ts`) — already
  declares the R2 binding and states in its own comment: *"Only the health route exists for now;
  the proxied stream + revoke/expiry checks + `share_access_log` write are future work."* This
  story is that future work; it does not create the Worker, it fills it in.

## Acceptance Criteria

1. **Creating a share link is explicit and scoped to one single.** Given a single I manage, when
   I create a share link, I choose an expiry (a fixed set of durations — Dev Notes has the exact
   list) and whether to include the photo; the link is generated only after I confirm.

2. **The token is a forced server-side secret, never client-chosen.** Given a share-link create
   request, the `token` column is always overwritten by a database trigger with a fresh CSPRNG
   value (192 bits, hex-encoded) regardless of what a client supplies — mirroring
   `set_child_portal_token_defaults()`'s exact guarantee for the deleted portal.

3. **The link works for a connected shadchan with no MyShadchan account.** Given a valid,
   unexpired, unrevoked link, when it is opened in any browser, the recipient sees the single's
   opted-in profile snapshot and can download the resume file(s) — with **no** login, no
   `dataProvider`, and no raw R2 URL ever appearing in the response (AD-9).

4. **The photo is included only if the sharer chose it, at every layer.** Given a share link
   created with `include_photo = false`, the profile response and the file listing never mention
   or link to a photo — not merely hide it client-side. Given `include_photo = true`, the photo
   is served through the same proxied path as the resume files, never a direct storage URL.

5. **Every access is logged — every request, not just the first.** Given a valid link, when the
   recipient loads the profile view and separately downloads a file, **two** `share_access_log`
   rows are written (one per request), each with a timestamp; the sharer can see this log against
   their link.

6. **Revocation is immediate and total.** Given an active link, when the sharer revokes it, the
   very next request — profile view or file download — is refused, even one already in flight
   with a cached response is not served from that point forward (no caching layer sits between
   the Worker and the check).

7. **Expiry is enforced the same way as revocation.** Given a link whose `expires_at` has passed,
   any request against it is refused identically to a revoked one — the response does not
   distinguish "expired" from "revoked" from "never existed" (no oracle for link status, mirroring
   the deleted portal's "unknown or revoked token returns the same null" discipline).

8. **The sharer sees who accessed and when.** Given a share link with access history, the
   sharer's own view (in the app, not the public link) lists each access with its timestamp —
   satisfying AD-9's *"sharer sees who accessed and when."*

9. **Negative test — cross-account.** Given a share link belonging to household A, when a member
   of household B attempts to read, revoke, or view the access log for that link through the
   authenticated app, RLS refuses all three. Given the link's `token`, a member of household B
   opening the public link URL still only ever sees what **any** correctly-tokened recipient
   would see (the token, not household membership, is the credential on that path) — this is
   expected and is not a leak: the design's privacy boundary for this surface is possession of
   the token, exactly like the deleted portal's.
10. **`share_links` and `share_access_log` are never anon-reachable via PostgREST.** Given the
    `anon` role, `select`/`insert`/`update`/`delete` on both tables are all refused — the **only**
    path to this data for an unauthenticated caller is through the `share/` Worker using the
    service-role key, never a direct table or RPC grant to `anon` (this is what keeps AD-1's "the
    only anon-readable relation is `listings`" true even though this story adds two more tables
    that unauthenticated recipients effectively read from).

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
            user_agent text
        );
        ```
  - [ ] `single_id` is a soft reference, no FK — same reasoning and same precedent as
        `listings.single_id` (Story 9.1 Dev Notes, itself following `inbox_items.single_id`
        from `1-3-rename-children-to-singles.md`). `share_access_log.share_link_id` **does** get
        a real FK, since both rows live in the same table's namespace and cascading a delete of
        the link to its own log rows is exactly the intended lifecycle (Dev Notes "Does revoking
        delete the log" explains why revoke does **not** delete, but a hard link-delete, if ever
        exposed, correctly would).
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

- [ ] **Task 2 — RLS: household-side management, zero `anon` reach** (AC: 9, 10)
  - [ ] `alter table public.share_links enable row level security;` `force row level security;`
        (AD-1 requires `FORCE` on every table without exception, including one whose "real"
        readers are outside Postgres entirely).
  - [ ] `"Share links scoped to account"` — `for all to authenticated using (account_id =
        public.current_context_id()) with check (account_id = public.current_context_id())`.
        Standard account-scoped CRUD for the owning household — creating, listing, and revoking
        (revoke is an `update … set revoked_at = now()`, not a delete — see Dev Notes) all go
        through this one policy, consistent with how most of this domain's tables are scoped
        (`shidduchim`, `references`, etc. all use one blanket `for all` policy — do not invent a
        four-policy split here the way `listings` needed one, because there is no cross-role
        authorization nuance on this table: any household member who can see the single can
        manage that single's share links).
  - [ ] `alter table public.share_access_log enable row level security;` `force row level
        security;` `"Share access log readable by link owner"` — `for select to authenticated
        using (exists (select 1 from public.share_links sl where sl.id =
        share_access_log.share_link_id and sl.account_id = public.current_context_id()))`. No
        `insert`/`update`/`delete` policy for `authenticated` at all — the **only** writer of
        this table is the `share/` Worker, using the service-role key, which bypasses RLS
        entirely (AD-7). Do not grant `authenticated` any DML on this table.
  - [ ] `revoke all on table public.share_links, public.share_access_log from anon;` — no
        `grant … to anon` line at all, on either table, ever (AC-10). `grant select, insert,
        update on table public.share_links to authenticated;` (no `delete` — see Dev Notes "Does
        revoking delete the log," revocation is an update). `grant all on table
        public.share_links, public.share_access_log to service_role;` Corresponding sequence
        grants, `anon` excluded, same pattern as 9.1 Task 3.

- [ ] **Task 3 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_share_links`
  - [ ] Hand-check: confirm `FORCE ROW LEVEL SECURITY` on both tables, confirm no `anon` grant
        line was emitted on either (check against the fork's lingering `alter default privileges
        … grant all on tables to anon`, exactly as flagged in Story 9.1 Task 3), confirm the
        token trigger is `before insert` only (not `before insert or update`).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`,
        never `db push`.

- [ ] **Task 4 — The `share/` Worker: fill in the scaffold** (AC: 3, 4, 5, 6, 7, 10)
  - [ ] `workers/share/index.ts` already exists with the `ShareEnv` type (`BaseEnv` +
        `MEDIA_BUCKET: R2Bucket`) and a health route — extend the same `Hono` app, do not create
        a parallel one. Add:
        - `GET /r/:token` — looks up `share_links` by token **using the service-role client
          directly** (not `forAccount()`, since the account is not known until the token
          resolves it — the token itself is the trusted root here, the same role a verified
          invite token plays per AD-7). If missing, revoked, or expired: identical `404`
          response in all three cases (AC-7's no-oracle rule). Otherwise: write one
          `share_access_log` row (`resource: "profile"`), then read the single's opted-in
          profile fields and file manifest (see Task 5 for the resume-shape dependency) and
          respond with the standard `{ success, data }` envelope
          [Source: ARCHITECTURE-SPINE.md — Worker API convention] — the file manifest lists
          `downloadUrl: "/r/:token/file/:fileKey"` entries, never a raw R2 URL, and omits the
          photo entry entirely when `include_photo` is false.
        - `GET /r/:token/file/:fileKey` — re-validates revoke/expiry (AC-6/7 apply to **every**
          request, including this one — do not cache the first check's result across requests),
          writes another `share_access_log` row (`resource: "resume:<fileKey>"` or `"photo"`),
          then streams the R2 object directly through the Worker response (`MEDIA_BUCKET.get()`
          → stream the body) — never a redirect to R2, never a pre-signed URL (AD-9's explicit
          "recipients never get a raw or pre-signed R2 URL" rule).
  - [ ] Use `forAccount(shareLink.account_id, env)` (existing `workers/shared/forAccount.ts`) for
        the singles/resume reads **once the account is known from the resolved token** — do not
        query tenant tables with the raw service-role client beyond the initial `share_links`
        lookup; that lookup is the one place AD-7's "trusted root" derivation happens, everything
        downstream of it goes through the scoped client like every other Worker.
  - [ ] `workers/share/index.test.ts` already tests `/health` — extend it, do not replace it.
        Cover: valid token → 200 + envelope; unknown/revoked/expired token → identical 404 for
        all three (assert byte-for-byte identical body, not just the same status code); revoked
        mid-session → the very next request after revoke fails (simulate by revoking between two
        calls in the same test); `include_photo = false` → no photo entry in the manifest;
        two requests → two `share_access_log` rows with distinct `resource` values.

- [ ] **Task 5 — Dependency on Epic 5's resume shape (read before writing Worker queries)**
      (AC: 3)
  - [ ] Today, `public.resumes` is keyed by `shidduchim_id` only (1:1 with a suggestion, not a
        single). Epic 5 Stories 5.3/5.8 are expected to establish a single's **own** addressable
        resume by the time this story starts. **Check the actual schema at implementation time
        before writing anything**:
        - If Epic 5 has added a way to address a single's own resume directly (whatever column
          or table shape it ends up being), use that as the source for the file manifest.
        - If it has not, this story's own fallback is: extend `public.resumes` with a nullable
          `single_id bigint` alongside the existing `shidduchim_id bigint not null`, changed to
          nullable, plus `constraint resumes_subject_check check ((shidduchim_id is not null)
          <> (single_id is not null))` — the same polymorphic-subject-with-XOR-check discipline
          AD-1 already applies to `interactions`/`tasks`. Do this as a **visibly separate**
          migration/commit from the rest of this story's work, and flag it loudly in the PR,
          since it is properly Epic 5's scope being pulled forward out of necessity, not an
          Epic-9 design choice.
  - [ ] Either way, the photo source is whatever Epic 5 Story 5.4's "explicit reveal" record
        turns out to be — do not build a second, parallel photo-storage path here. If 5.4 has not
        landed, the `include_photo` toggle (Task 6) ships disabled with an explanatory tooltip,
        exactly as Story 9.2 Task 5 specifies for the same reason.

- [ ] **Task 6 — Provider and components** (AC: 1, 6, 8)
  - [ ] `providers/supabase/dataProvider.ts`: plain `dataProvider.create("share_links", {
        single_id, expires_at, include_photo })` / `dataProvider.getList("share_links", …)` for
        the sharer's own list; **revoke is `dataProvider.update("share_links", { id: { revoked_at:
        now } })`**, not a delete (Dev Notes "Does revoking delete the log"). Add a
        `getShareAccessLog(shareLinkId)` custom method reading `share_access_log` (AC-8).
  - [ ] `providers/fakerest/`: add `share_links` and `share_access_log` base resources; since
        FakeRest has no triggers, emulate the CSPRNG-token-on-create behavior in
        `internal/shareLinks.ts` (same "hand-written twin of a Postgres-only behavior" pattern as
        Story 9.3's `internal/listingWithdrawal.ts`). FakeRest cannot emulate the Worker's proxy
        stream — its `share/` surface is exercised only by the Worker's own Vitest suite (Task 4),
        not through the FakeRest demo build; say this explicitly in the FakeRest file's own
        comment so a future contributor does not go looking for it there.
  - [ ] New directory `src/components/atomic-crm/sharing/` — named exactly as the architecture
        spine's own planned source tree already lists it
        (`ARCHITECTURE-SPINE.md` §"Source tree (new work in bold)": *"`resumes/ references/
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
        `ChildPortalPage.tsx`'s unauthenticated-shell pattern).
  - [ ] `src/App.tsx`: add the `isShareUrl(window.location)` check before `<LandingGate>`,
        alongside the `/find` check this epic's Story 9.4 already added — both are pre-CRM
        routes now; keep them as separate, clearly named early-returns rather than merging into
        one generic "public route" branch, since their token handling (fragment vs. query) and
        data source (Worker fetch vs. direct Supabase client) are genuinely different.
  - [ ] Where the sharer reaches this from: Settings, next to Story 9.2's
        `settings/SingleListingSection.tsx` — a "Share" action per single, opening
        `CreateShareLinkDialog`. Same rationale as 9.2 Task 5 for not putting this on the Single
        360's tab bar (Epic 5 Story 5.8 does not list it).

- [ ] **Task 7 — Tests** (AC: all)
  - [ ] `supabase/tests/share_links.sql` + `.test.ts` — new database suite, same harness as
        `billing_entitlement.sql`. Checks: AC-2 (token is always CSPRNG-overwritten regardless of
        client-supplied value), AC-9 (cross-account refused on all of select/update against
        `share_links`, and select against `share_access_log`), AC-10
        (`has_table_privilege('anon', 'public.share_links', 'SELECT')` etc. all false, on both
        tables — the direct counterpart to `child_portal.sql`'s existing "anon has NO privilege
        on `child_portal_tokens`" checks, lines ~254–258 of that now-deleted file, cited here as
        the template even though the file itself is gone by the time this story runs).
  - [ ] `workers/share/index.test.ts` — the full list under Task 4's last bullet.
  - [ ] Frontend component tests for `CreateShareLinkDialog`, `ShareLinkList` (revoke action,
        access-log rendering), `SharedProfilePage` (loading/inactive/active states, mirroring
        `ChildPortalPage.test.tsx`'s three-state shape), and the two new `App.tsx` branches.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db` (the SQL suite) —
        `make test` already covers `workers/**/*.test.ts` via `test:unit:workers`
        [Source: vitest.config.ts, makefile:108], so the Worker tests need no separate
        invocation, unlike the database suite. Plus `npx prettier --check` on this story's
        changed files only.

## Dev Notes

### Why a Worker, not another anon RPC (the deleted portal's mechanism, deliberately not reused)

The deleted child portal proved that a single `SECURITY DEFINER` RPC granted to `anon` can safely
serve unauthenticated reads when its own scoping is airtight. This story does not reuse that
shape, for two concrete reasons AD-9 states directly: (1) **file bytes**. The portal only ever
returned JSON; this story must serve actual resume/photo file content, and AD-9 requires that be
a **proxied stream** through R2, which is an HTTP-body concern a Postgres function cannot perform
— it has to be a runtime that can hold an R2 binding and stream a response, which is what a
Worker is for (AD-7's "compute home"). (2) **AD-1's tightened anon surface.** By the time this
story runs, AD-1's rule is that `listings` is *"the only anon-readable relation in the product"* —
adding a second `anon`-grantable RPC here, however tightly scoped, would make that sentence false.
Routing through a Worker using the service-role key keeps the *Postgres* anon-surface exactly one
relation wide, while still serving the unauthenticated recipient at the HTTP layer.

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

### Dependency on Epic 5's resume shape — flag this to the epic owner

`epics.md`'s Epic 9 story list assumes a single has "a profile and a resume" to share (this
story's own title), but the *only* epic that will have built a single's addressable resume
record by the time Epic 9 runs is Epic 5 (Stories 5.3, 5.8) — and Epic 9's requirements coverage
row (`FR101–107, PRV-13`) does not list this as a stated dependency anywhere in `epics.md`. Task 5
gives the concrete fallback so this story is not blocked if Epic 5's shape is not yet finalized,
but the cleaner fix is a correct-course on the epic list itself, adding an explicit
"9.5 depends on 5.3/5.8" line — raised here rather than resolved unilaterally, per this
documentation pass's own instructions not to invent scope silently.

### Security / RLS

New Worker surface with a service-role key, two new tables, R2 access, and unauthenticated file
serving — `.claude/rules/security-triggers.md`'s triggers ("external API calls," "file system
operations," "user input handling") all apply at once. AC-9 and AC-10 are the required negative
tests. The single highest-value review point: confirm `GET /r/:token/file/:fileKey` re-checks
`revoked_at`/`expires_at` on **every** call rather than trusting a check performed by
`GET /r/:token` earlier in the same session — AC-6/7 are worded "every request" specifically to
rule out a cached-authorization shortcut.

### Migration workflow

Same as every other story in this epic: schema-first, `DBUS_SESSION_BUS_ADDRESS=/dev/null` on
every `npx supabase` call, never `db reset`/`db push`
[Source: AGENTS.md#Database-Management, memory/supabase-cli-dbus-hang.md].

### Testing standards

`supabase/tests/share_links.sql` runs only under `npm run test:unit:db`, outside `make test`
[Source: vitest.config.ts:124, makefile:108]. `workers/**/*.test.ts` **is** covered by `make test`
via `test:unit:workers` [Source: package.json, makefile:108] — do not report this story done
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
  `ShareEnv`/`createWorkerApp("share")` scaffold and its `/health` route stay exactly as they are.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.5-Revocable-share-links]
- [Source: amendment-a2.md#A2.5] — FR107, and its note that this is "the sole surviving use of tokenised access"
- [Source: ARCHITECTURE-SPINE.md#AD-9] — proxied-stream rule, access logging, no raw/pre-signed URLs, revoke=immediate
- [Source: ARCHITECTURE-SPINE.md#AD-7] — `forAccount()` scoped client, trusted-root derivation
- [Source: ARCHITECTURE-SPINE.md#AD-1] — the "sole anon-readable relation" constraint this story must not violate
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/SOLUTION-DESIGN.md §4] — `share_links`/`share_access_log` named in the data model
- [Source: workers/share/index.ts, wrangler.toml, index.test.ts] — the existing scaffold this story fills in
- [Source: workers/shared/forAccount.ts, createApp.ts, envelope.ts] — the Worker conventions this story must reuse, not reinvent
- [Source: supabase/schemas/02_functions.sql — `set_child_portal_token_defaults()`, `get_child_portal()`] — the CSPRNG-token and no-oracle precedents (both deleted by Epic 1 Story 1.4, cited here from the pre-deletion codebase this documentation pass read)
- [Source: 1-4-retire-token-portal.md] — confirms the portal is gone and explicitly hands FR107 to this epic
- [Source: 9-1-publish-shadchan-listing.md#Dev-Notes] — the soft-reference (`single_id`, no FK) precedent this story also uses
- [Source: 9-2-publish-single-listing.md, 9-3-single-controls-own-listing.md] — the "gate the photo behind Epic 5 Story 5.4" precedent this story repeats
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.3-Resume-tab-with-version-history, #Story-5.8-Single-360] — the unstated cross-epic dependency flagged in Dev Notes
- [Source: .claude/rules/security-triggers.md] — review triggers for external calls, file ops, user input
- [Source: AGENTS.md#Database-Management] — migration workflow

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
