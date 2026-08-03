# Story 10.3: Email ingress verified end to end

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want forwarding to my private address to work,
so that the phone-less path is real — not a webhook that has never once been exercised
by an automated test.

## Position in Epic 10

Lands **first** of the three: **10.2** depends on this story's renamed function and
exported test handler; **10.1** is independent (different files) but nothing here
blocks it. Runs on the **post-Epic-1 / post-Epic-2** codebase: `sales` is `members`,
`children`/`child_id` is `singles`/`single_id`, and — per AD-2 — `accounts` now carries
a `kind` column (`household | shadchanus`).

## Acceptance Criteria

1. **A forwarded message with an attachment reaches the Inbox intact.** A known
   member forwards an email with a PDF/image attachment to the inbound address; an
   `inbox_items` row is created in their account with `attachments` populated and the
   file byte-identical to what was sent — decided in the integration test by
   asserting the bytes passed to the mocked storage upload equal the decoded base64
   sent, and in the e2e by fetching the stored attachment's `src` and comparing
   bytes.

2. **A member holding more than one context never has an email mis-routed.** Since
   Epic 2 (AD-2), a member may hold a household membership *and* a shadchanus
   membership at once. The current `resolveAccountIdForSalesEmail` picks "the first
   `account_id` ascending" — exactly the arbitrary-selection anti-pattern AD-19
   eliminates from RLS, just reimplemented in a service-role Edge Function that RLS
   never touches. This story replaces it with a resolver that selects the member's
   **household**-kind account specifically — capture is a household concern, never a
   shadchanus one (AD-2: *"a shadchanus context may never contain household domain
   rows"*). **Negative tests:** a member with both a household and a shadchanus
   membership always has their forwarded email land in the household account, never
   the shadchanus one; a member with no household membership at all (e.g.
   shadchan-only) gets the existing 403 refusal rather than a wrong guess; and a
   member holding **two** household memberships (representable — e.g. a parent who is
   also a `helper` in a sibling's household, family shape 4) is **refused (403),
   never arbitrarily picked** — with more than one candidate there is no
   deterministic answer, and AD-6's email rule is ambiguous → flagged, never
   auto-picked.

3. **The webhook handler itself is under test, not just its helper functions.**
   `supabase/functions/postmark/index.ts`'s handler is exported and exercised by a new
   integration test covering: a known member's forward with an attachment → 200 +
   correct `inbox_items` insert; an unknown sender → 403 + nothing written; a bad
   Authorization header → 401.

4. **An automated end-to-end test covers the path.** A Playwright spec drives the real
   local stack: POST to the local `postmark` function (the same shape as the
   docstring's curl example) as a known member with an attachment, then load
   `/inbox_items` in the browser and assert the card renders with the attachment
   reachable.

5. **The inbound address is actually discoverable.** A signed-in member can see the
   address to forward/CC to, with a one-tap copy, in Settings — the phone-less path
   the epic promises cannot be "real" if nobody is ever shown where to send mail.

6. **`inbox_items` has automated proof of account isolation.** No SQL-level test
   exists for this table today (`supabase/tests/` has suites for `references_entity`,
   `shidduch_catch`, `billing_entitlement` and 27 others — none for `inbox_items`,
   despite it holding captured personal content; there is no `child_portal` suite
   to compare against either — that surface was deleted outright by Story 1.4,
   commit `c053d40`). A new suite proves: an account-A client reads only account-A's
   `inbox_items` rows; an account-A client cannot insert/update a row carrying
   account B's `account_id`; `service_role` (the webhook's identity) can insert
   regardless.

7. **The deployed function can actually start, and a missing secret is loud, not
   silent.** `postmark/index.ts` reads `POSTMARK_WEBHOOK_USER`,
   `POSTMARK_WEBHOOK_PASSWORD` and `POSTMARK_WEBHOOK_AUTHORIZED_IPS` at **module
   scope** and `throw`s if any is absent — and today none of the three, nor
   `VITE_INBOUND_EMAIL`, is ever pushed to the hosted Supabase project. The
   deployed function has therefore never booted in production; every invocation
   returns an opaque `500 WORKER_ERROR` regardless of payload, indistinguishable
   from a parsing bug. After this story: (a) all four values are provisioned as
   real Supabase function secrets by CI, and (b) a still-missing value at runtime
   produces a specific, logged `500` from *inside* the request handler, never an
   import-time crash the function can't recover from or explain. **Test:** with a
   required env var unset, the exported handler still executes and returns `500`
   (decided in `index.test.ts`) — proving the check is per-request, not
   per-cold-start.

## Tasks / Subtasks

- [ ] **Task 1 — Stop the function dying at cold start; provision its production
      secrets** (AC: 7)
  - [ ] **Why this is Task 1, not cleanup:** `supabase/functions/postmark/index.ts:20-31`
        reads `POSTMARK_WEBHOOK_USER`, `POSTMARK_WEBHOOK_PASSWORD` and
        `POSTMARK_WEBHOOK_AUTHORIZED_IPS` at **module scope** and `throw`s if any is
        missing. None of the three is pushed to the hosted project today —
        `.github/workflows/deploy.yml`'s "📡 Push supabase function secrets" step
        (`:150-155`) sets only `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL` and
        `UPSTASH_REDIS_REST_TOKEN` — and `VITE_INBOUND_EMAIL` (`index.ts:22`, used for
        the forwarding-detection branch) is pushed nowhere either. The deployed
        function therefore throws on its very first cold start, before it sees a
        request, and Supabase reports that as an opaque `500 WORKER_ERROR` on every
        invocation. **This is why inbound email capture has never worked in
        production** — not a defect in the parsing/attribution logic Tasks 2–7 touch.
        Fixing only the missing values without also fixing the module-scope throw
        leaves the same failure mode live for the next missing/rotated secret: a
        function that cannot start cannot log *why* it can't start.
  - [ ] `supabase/functions/postmark/index.ts`: move the three `Deno.env.get(...)`
        reads and their presence checks **out of module scope and into the request
        handler** — do this in the same pass as Task 3's `handleInboundEmail`
        extraction, not a second one. On a missing/empty value, `console.error` a
        specific, greppable message naming which variable is absent, and return a
        `500` response. The function now boots regardless of secret state; a
        misconfiguration becomes a per-request, log-visible condition instead of a
        total, silent outage.
  - [ ] Add three new GitHub Actions repository secrets: `POSTMARK_WEBHOOK_USER`,
        `POSTMARK_WEBHOOK_PASSWORD`, `POSTMARK_WEBHOOK_AUTHORIZED_IPS`
        (operator-chosen Basic-Auth credentials, and Postmark's published inbound IP
        list — `supabase/functions/.env`'s existing local values are the reference
        for the IPs, which are Postmark's own public webhook source list, not a
        secret in themselves; that file's Docker-only entries are local-only and
        should not travel to production). Mirror the existing `RESEND_API_KEY`
        secret (`deploy.yml:23`) — same job, same pattern, nothing new to invent.
  - [ ] `.github/workflows/deploy.yml`: add the three names (plus `VITE_INBOUND_EMAIL`)
        to the job's `env:` block (`:17-24`) and extend the existing "📡 Push supabase
        function secrets" step (`:150-155`) with `npx supabase secrets set
        POSTMARK_WEBHOOK_USER=${{ env.POSTMARK_WEBHOOK_USER }}`, `...PASSWORD=...`,
        `...AUTHORIZED_IPS=...`, and `VITE_INBOUND_EMAIL=${{ env.VITE_INBOUND_EMAIL }}`
        — a **Supabase function secret**, a separate channel from `vite.config.ts`'s
        `define` block (which only reaches the browser bundle); the Edge Function
        needs its own copy of the same value. Widen the step's `if:` to require the
        new secrets too, the same "loud skip, not silent skip" shape the existing
        step already uses — do not let this step silently no-op the way
        `deploy-workers` has done for other workers in the past.
  - [ ] Test (in `index.test.ts`, Task 3): calling the exported handler with one of
        the four env vars unset (`vi.stubEnv` or the equivalent the `functions`
        vitest project already supports) still executes and returns `500`, and
        `supabaseAdmin` is never reached — proving the failure is now request-scoped
        and diagnosable, not an import-time throw a unit test can't even exercise.

- [ ] **Task 2 — Fix the account-resolution anti-pattern** (AC: 2)
  - [ ] `supabase/functions/postmark/createInboxItemFromEmail.ts`: rename
        `resolveAccountIdForMemberEmail` (10.2's dependency: this is the post-1.2 name
        of the pre-Epic-1 `resolveAccountIdForSalesEmail`) to
        `resolveHouseholdAccountIdForMemberEmail`. Change the `account_members` query
        to join `accounts`, filter `accounts.kind = 'household'`, and drop the
        `.order(...).limit(1).maybeSingle()`:
        ```ts
        const { data: memberships } = await supabaseAdmin
          .from("account_members")
          .select("account_id, accounts!inner(kind)")
          .eq("user_id", member.user_id)
          .eq("accounts.kind", "household");
        ```
        Return the `account_id` when **exactly one** row comes back; return `null`
        (→ the existing 403 upstream) for zero **or two-plus**, logging the two-plus
        case with `console.error` context. No filtered-embed idiom exists anywhere in
        the repo yet (verified: no `!inner` under `src/`, `workers/` or `supabase/`) —
        this standard supabase-js embed becomes the first; don't invent a two-query
        workaround. Why fail-closed on two-plus: personas-and-contexts.md guarantees
        a *single* belongs to one household, **not** that a *login* holds at most one
        household membership (a parent can also be a `helper` elsewhere — family
        shape 4); with several candidates any pick is the arbitrary-selection
        anti-pattern AD-19 kills, and per AD-6 ambiguous is flagged, never
        auto-picked. A refused capture is recoverable (the member shares or uploads
        from inside the app); a mis-filed one crosses an account boundary.
  - [ ] Update the doc comment (currently: *"Resolve the MyShadchan account for a
        forwarding user, keyed by their `sales` email..."*) to state the household-only
        rule and cite AD-2.
  - [ ] `index.ts`: update the import and call site.

- [ ] **Task 3 — Export the handler; add the integration test** (AC: 3, 7)
  - [ ] `supabase/functions/postmark/index.ts`: extract the `Deno.serve(async (req) =>
        {...})` body into a named, exported function (e.g. `export async function
        handleInboundEmail(req: Request): Promise<Response>`) and pass it to
        `Deno.serve(handleInboundEmail)`. This is also where Task 1's env-var checks
        move to (request-scoped, not module-scoped) — one extraction, not two passes
        over the same function. Otherwise a pure refactor — behavior unchanged.
  - [ ] New `supabase/functions/postmark/index.test.ts` (Node/vitest, `functions`
        project — see `vitest.config.ts`): mock `../_shared/supabaseAdmin.ts` with the
        `vi.hoisted(() => vi.fn())` + `vi.mock(...)` pattern
        `addNoteToContact.test.ts` already establishes (that file itself is deleted by
        Epic 1's 1.1, but the pattern survives — copy the mocking shape, not the
        file). Cover:
        - Missing/incorrect `x-forwarded-for` or `Authorization` → 401, nothing
          written.
        - Wrong HTTP method → 405.
        - Missing required body fields (`ToFull`/`FromFull`/`Subject`/`TextBody`) →
          403, nothing written.
        - Known member, no attachment → 200, one `inbox_items` insert with the
          expected shape.
        - Known member, one attachment → 200, `extractAndUploadAttachments` called,
          the insert's `attachments` array populated.
        - Unknown sender → 403, `inbox_items` insert never called.
        - Member with both a household and a shadchanus membership → the insert's
          `account_id` is the household account (AC 2's negative test, exercised here
          via the mocked `supabaseAdmin` responses rather than a live DB — the DB-level
          proof is Task 4's SQL suite for RLS; this is the resolution-*logic* proof).
        - Member with **two household memberships** → 403, `inbox_items` insert never
          called (AC 2's fail-closed branch).
        - **A required env var missing (Task 1, AC 7)** → `500`, `supabaseAdmin`
          never reached.

  **Struck — do not implement.** An earlier draft of this story carried a "Task 3 —
  harden attachment naming" instructing `${Math.random()}${fileExt}` →
  `${crypto.randomUUID()}${fileExt}` in `extractAndUploadAttachments.ts`. Read the
  file first: it already does exactly that (`fileName =
  \`${accountId}/${crypto.randomUUID()}${fileExt}\``), landed by commit `31183f2`
  ("SECURITY: make the attachments bucket private and account-scoped"), which also
  set `public = false` on the bucket and moved both upload sites to signed,
  expiring URLs. The task is a no-op diff against the current tree — do not
  re-implement it. See the corrected Dev Note below; the privacy gap this used to
  flag is closed, not deferred to Epic 9.

- [ ] **Task 4 — Close the missing `inbox_items` RLS gap** (AC: 6)
  - [ ] New `supabase/tests/inbox_items.sql` + `supabase/tests/inbox_items.test.ts`,
        following the exact structure of `supabase/tests/shidduch_catch.sql` /
        `.test.ts` (temp `results` table, one row appended per check, JSON emitted at
        the end, `begin;`/`rollback;`, the runner turns each row into a named
        `it(...)`). This suite doesn't exist today — `inbox_items` currently has zero
        SQL-level test coverage despite carrying captured personal content. Assert, at
        minimum:
        - Account A's authenticated client sees only account A's `inbox_items` rows,
          never account B's (select).
        - Account A's client cannot insert or update a row with account B's
          `account_id` (with-check).
        - `service_role` can insert regardless of RLS (the webhook path).
  - [ ] `npm run test:unit:db` (needs `make start`).

- [ ] **Task 5 — Make the attachment visible in the Inbox** (AC: 1, 4)
  - [ ] Today neither Inbox surface renders `attachments` at all — `InboxList.tsx`'s
        card prints the placeholder "An attachment, ready to file." and
        `InboxResolveDialog.tsx`'s preview says "No text — see the attached file."
        with no link (verified). AC 4's "attachment reachable" is unimplementable
        without this task.
  - [ ] `src/components/atomic-crm/types.ts`: type the entries —
        `InboxAttachment = { title: string; type: string; path: string; src: string }`
        (the webhook's shape) and narrow `InboxItem.attachments` to
        `InboxAttachment[] | null`.
  - [ ] `InboxResolveDialog.tsx`: in the raw-capture preview block, render each
        attachment as its `title` linking to `src` (`target="_blank"
        rel="noreferrer"`).
  - [ ] `InboxList.tsx` (`InboxCard`): a small paperclip chip with the attachment
        count/first title — existing muted-text styling, no new component.

- [ ] **Task 6 — Surface the inbound address in Settings** (AC: 5)
  - [ ] New `src/components/atomic-crm/settings/CaptureSection.tsx` (matches the
        existing one-file-per-section pattern: `FamilySection.tsx`,
        `PrivacySection.tsx`, `PreferencesSection.tsx`): reads
        `import.meta.env.VITE_INBOUND_EMAIL`, renders it in a monospace chip with a
        copy-to-clipboard button — no shared copy primitive exists (the two current
        `navigator.clipboard` call sites, `children/ChildPortalShare.tsx` and
        `contacts/ContactPersonalInfo.tsx`, are both deleted by Epic 1); a small
        inline `navigator.clipboard.writeText` button here is correct, don't build a
        generic component for one caller. Plus one sentence of explanation, routed
        through `translate()` with an English **and** French catalogue entry added
        in this diff (e.g. `crm.settings.capture.*` — `frenchCrmMessages.ts` ends
        `} satisfies CrmMessages;`, so a missing French twin fails `make typecheck`,
        and a hardcoded string would type-check while silently staying English in
        the French UI): "Forward or CC any redt to this address — it lands in your
        own Inbox." The mockup's `isShare` desktop panel shows exactly this
        affordance (`you@in.myshadchan.space ⧉`).
  - [ ] Wire it into `settings/SettingsPage.tsx` and `settings/SettingsPageMobile.tsx`.
        **Do not place it by position ("after `PreferencesSection`, before
        `PrivacySection`") — that adjacency no longer exists.** `SettingsPage.tsx` is
        now two columns; `PreferencesSection` is the last item of the *left* column
        and `PrivacySection` sits near the end of the *right* column, separated by
        `CommunicationSection`, `ConnectionSection` and `ShadchanListingSection`
        (Epic 8 inserted `ConnectionSection` since this story was drafted). State the
        **grouping intent** instead and re-derive the exact slot from the file as
        found: `CaptureSection` is about how mail reaches the account, the same
        concern `CommunicationSection` (notification/visibility defaults) already
        covers — group it near that section, in whichever column the file's current
        layout makes natural. Apply the same instruction to
        `SettingsPageMobile.tsx` **separately** — it is single-column, has its own
        section order, and is easy to forget as "the same file."
  - [ ] If `VITE_INBOUND_EMAIL` is unset (local dev without the env var), render
        nothing rather than an empty chip — this section is informational, not a
        blocking requirement.

- [ ] **Task 7 — End-to-end test** (AC: 4)
  - [ ] New `e2e/email-ingress.spec.ts`: seed a member (via whatever helper
        `e2e/fixtures.ts` provides post-Epic-1/Epic-2 for creating an authenticated
        household member — inspect the current shape of that file rather than
        assuming pre-Epic-1 helper names, since 1.2/1.3/1.6 rewrite it), `POST` to
        `http://127.0.0.1:54321/functions/v1/postmark` with the member's email as
        `FromFull.Email`, a `TextBody`, and one small attachment (base64), using the
        Basic-Auth credentials from `POSTMARK_WEBHOOK_USER`/`POSTMARK_WEBHOOK_PASSWORD`
        and an `x-forwarded-for` header matching `POSTMARK_WEBHOOK_AUTHORIZED_IPS`
        (see the docstring examples already in `postmark/index.ts` for the exact
        payload shape). Then sign in as that member: `e2e/fixtures.ts:472` already
        declares `signIn(page, email)` (reads the OTP straight out of Inbucket,
        http://localhost:54324) and exposes it as a **Playwright fixture**, not a
        plain export (`:495,533`) — consume it as `test("…", async ({ page, signIn })
        => { await signIn(page, member.email); … })`, never `import { signIn } from
        "./fixtures"` (that import fails; `signIn` itself is module-private). Do not
        add a second sign-in helper — one already exists. Navigate to `/inbox_items`
        and assert the new card is visible with the attachment reachable (Task 5's
        rendering), fetching its `src` and comparing bytes to what was sent (AC 1).

## Dev Notes

### Why this story exists, and what "verified" means here

The epic's own AC is narrow and concrete: *"Given the inbound address, When I forward
a message with an attachment, Then it appears in my Inbox with the attachment intact,
And an automated end-to-end test covers the path."* [Source: epics.md#Story-10.3].
This is a **hardening and verification** story on the existing, already-deployed
Postmark pipeline (per user memory: E1–E7 deployed to production under the prior
numbering) — not a rebuild.

**"Automated end-to-end test" is defined two ways here, deliberately:** (a) a
handler-level integration test (Task 3) — the practical, fast, CI-friendly proof that
the webhook's own logic is correct, following the exact mocking convention this repo
already uses for edge functions; and (b) a Playwright spec (Task 7) that drives the
real local function + real database + real UI, per this repo's own
`e2e-conventions` rule ("touches UI" → needs a spec under `e2e/`). Neither replaces the
other: (a) is fast and precise about branches; (b) is the actual user-visible promise
in the AC ("appears in my Inbox").

### Why the account-resolution fix belongs here, not in Epic 2

Epic 2 rewrites `current_account_id()` for **RLS-governed** reads (AD-19). This
Edge Function runs as `service_role` and **never touches RLS at all** — it calls
`supabaseAdmin`, which bypasses row security entirely. AD-19's rewrite does nothing for
it. Left alone, `resolveAccountIdForSalesEmail`'s `.order("account_id",
{ascending: true}).limit(1)` silently reintroduces the exact bug AD-19 exists to kill,
the moment Epic 2 makes multi-context membership possible. Since this story is the one
touching this function for renaming/testing reasons anyway, it is the natural, minimal
place to close this — not a new epic, not deferred.

### Explicitly out of scope — flagged, not silently dropped

1. **Migrating off Postmark to Cloudflare Email Routing + a Worker (`workers/ingest/`,
   `postal-mime`).** `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`'s stack table names Cloudflare Email
   Routing as the intended email channel, and `workers/ingest/index.ts`'s own comment
   says the email handler is *"a stub for that rule until the inbox_item schema and
   postal-mime parsing land (separate future work)."* That "separate future work" is
   a real, undone migration — but it is **not named by any story in the current epic
   list** (Epic 10's FR coverage row is `FR27–28, FR78` only; no story anywhere says
   "migrate email ingress off Postmark"). Rather than silently absorbing an
   unscoped infrastructure migration into a "verify this AC" story, this is flagged
   here and in the final report as a gap the epic list does not currently cover.
   This story verifies and hardens the **existing, working** Postmark path.
2. **Attachment storage privacy — already fixed, not a gap to flag.** An earlier
   draft of this story reported that `extractAndUploadAttachments.ts` uploads to a
   `public: true` bucket and returns an unauthenticated `getPublicUrl()`,
   contradicting AD-9, and deferred closing it to Epic 9. **That has since been
   fixed, on `main`, by commit `31183f2`** ("SECURITY: make the attachments bucket
   private and account-scoped"): `supabase/schemas/07_storage.sql` sets `public =
   false` with account-scoped RLS policies keyed on an `{account_id}/…` prefix, and
   `extractAndUploadAttachments.ts` already writes `${accountId}/${crypto.randomUUID()}${fileExt}`
   keys and returns a **signed, expiring** URL (`createSignedUrl`, 1-hour TTL), never
   a public one. Verify this by reading the file before touching it — do not
   re-open this as a gap or re-flag it to Epic 9; there is nothing there to pick up.
   (The corresponding Task in an earlier draft of this story, which asked to swap
   `Math.random()` for `crypto.randomUUID()`, is struck for the same reason — see
   the note in the Tasks section.)
3. **FR22's per-account private inbound address.** The product currently has one
   *global* inbound address (`VITE_INBOUND_EMAIL`), with attribution done entirely by
   matching the SMTP sender against a known member's own registered email — not by a
   per-account address suffix. FR22 ("each account has a private inbound address")
   isn't in Epic 10's FR coverage row either. This story surfaces the existing global
   address (Task 6) so the path is at least discoverable and usable; it does not
   build per-account addressing.

### What already exists — reuse, do not rebuild

- `supabase/functions/postmark/index.ts`'s docstring already contains two working
  curl examples (plain forward, and forward-to-shared-address) — Task 7's e2e POST
  body should match that exact JSON shape, not reinvent a Postmark payload from
  scratch.
- `supabase/functions/postmark/addNoteToContact.test.ts`'s `vi.hoisted` +
  `vi.mock("../_shared/supabaseAdmin.ts", ...)` pattern (this file is deleted by
  Epic 1's 1.1, but read it — or its git history — for the mocking shape before it's
  gone; the pattern, not the file, is what to keep).
- `supabase/tests/shidduch_catch.sql` / `references_entity.sql` and their `.test.ts`
  runners — the exact template for Task 4's new suite. Do not invent a different
  test-report format.
- `settings/{FamilySection,PrivacySection,PreferencesSection}.tsx` — the established
  one-section-per-file pattern and the `SectionLabel.tsx` primitive they share.

### Project Structure Notes

- New: `supabase/functions/postmark/index.test.ts`, `supabase/tests/inbox_items.sql`,
  `supabase/tests/inbox_items.test.ts`,
  `src/components/atomic-crm/settings/CaptureSection.tsx`,
  `e2e/email-ingress.spec.ts`.
- Modified: `supabase/functions/postmark/{createInboxItemFromEmail.ts,index.ts,
  extractAndUploadAttachments.ts}` (the last one is a no-op — see the struck Task
  note; touch it only if a fresh read shows otherwise),
  `.github/workflows/deploy.yml` (Task 1 — new secrets in the job `env:` block and
  the "Push supabase function secrets" step), `settings/{SettingsPage.tsx,
  SettingsPageMobile.tsx}`, `src/components/atomic-crm/types.ts`,
  `src/components/atomic-crm/inbox/{InboxList.tsx,InboxResolveDialog.tsx}` (Task 5),
  `src/components/atomic-crm/providers/commons/{englishCrmMessages.ts,
  frenchCrmMessages.ts}` (Task 6's new copy — French twin required or `make
  typecheck` fails), `registry.json` (generated — the new `CaptureSection.tsx` lands
  under the glob `scripts/generate-registry.mjs` scans; `make registry-gen`
  regenerates it, but declare it so the diff isn't a surprise), and — only if no
  authenticated-session helper exists by then — `e2e/fixtures.ts` (Task 7; today one
  already exists as a fixture, `signIn` at `e2e/fixtures.ts:472`, so this is very
  unlikely to be needed — see Task 7).
- No schema/migration in this story (it consumes `accounts.kind`, added by Epic 2 —
  verify that column exists before starting Task 2; if Epic 2 hasn't actually added
  it yet in the branch this is implemented against, that is a blocking prerequisite,
  not something to work around with a fallback query — NFR-14). **Confirmed present
  on `main` today**: `accounts_kind_check check (kind in ('household',
  'shadchanus'))` (`01_tables.sql:215`).

### Testing standard

`.claude/rules/testing.md`: AAA, descriptive names, ≥80% new-code coverage, isolated
tests (no shared mutable state; `beforeEach` resets mocks). `.claude/rules/security-triggers.md`
applies in full here — external API calls (Postmark), user input handling (email
body/attachments), database queries, file system operations. Dispatch
SECURITY-REVIEWER on this diff at implementation time. `e2e-conventions`: the e2e spec
is required (this touches the Inbox UI) and must assert user-visible behavior, not
just a 200 response.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Capture-Funnel-Completion]
  — Story 10.3's stated AC.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-19] — the arbitrary-selection anti-pattern this
  story closes in the service-role path.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-2] — `accounts.kind ∈ household | shadchanus`;
  "a shadchanus context may never contain household domain rows."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-6] — Cloudflare Email Routing as the target
  channel; the explicit "separate future work" flag this story does not resolve.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9] — media/attachment privacy. An earlier
  draft of this story flagged this as an open gap for Epic 9; it is already closed
  on `main` by commit `31183f2` (see "Explicitly out of scope" #2 above) — cited
  here for the privacy rule itself, not as an open item.
- [Source: workers/ingest/index.ts] — the stub comment confirming the Cloudflare
  migration is real, undone work with no assigned story.
- [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md] —
  confirms `postmark/createInboxItemFromEmail.ts` and `postmark/index.ts` already
  carry the `members`/`resolveAccountIdForMemberEmail` naming by the time this story
  starts.

## Dependencies

- **Epic 1** (1.1, 1.2): fossil `postmark/` modules deleted, `sales`→`members` applied
  to the surviving `postmark/` files.
- **Epic 2** (at least the schema portion adding `accounts.kind`): Task 2 hard-depends
  on `accounts.kind` existing (confirmed present on `main` today — see Project
  Structure Notes). If not yet landed on the branch this is implemented against,
  this story is blocked on it — do not substitute a heuristic.
- This story **must land before 10.2** (renamed function, exported handler, new test
  file 10.2 extends).
- No dependency on **10.1**.

## Dev Agent Record

### Agent Model Used

claude-opus-5 (build, review, and review-fix passes).

### Debug Log References

Timestamps are UTC, from the runs themselves, so they can be checked against
the stack-1 server log rather than taken on trust.

- `13:16:46` — `inbox_items` db suite, 12/12, on a **freshly reset** stack 1.
- `13:17:03` — falsifiability of the same suite, on **stack 2** (its own lease,
  `STACK_OWNER=fix-10-3-mutation`), never on the stack carrying the real run.
- `13:27:50–13:27:59` — `e2e/email-ingress.spec.ts`, 2/2 (chromium + Mobile
  Chrome), after the `resolvePublicOrigin` fix below.
- `13:29:17` — full `make test`: 280 files / 3396 tests, all passing.
- `13:30:12` / `13:30:13` — final `inbox_items` (12/12) and
  `postmark/index.test.ts` (18/18).

**Voided and re-measured.** An earlier `inbox_items` result was taken while an
ad-hoc `alter policy … with check (true)` was live on stack 1 (window
`12:36:51`–`13:00:36` UTC). With that mutation in force the cross-account
checks pass *without testing anything*, so that result could not distinguish a
working suite from a broken one and was discarded rather than reported. Every
number above post-dates a full stack reset. The lesson is recorded here
because it is the same shape as `.claude/rules/migration-guard-integrity.md`:
a green that nobody could have watched go red is not evidence.

### Completion Notes List

**Review findings F1–F9, and what actually changed.**

- **F1** — `deploy.yml` now carries all four values
  (`POSTMARK_WEBHOOK_USER/PASSWORD/AUTHORIZED_IPS`, `VITE_INBOUND_EMAIL`) in
  the job `env:` block, pushed by a **separately gated** step so a missing
  Postmark secret can never block `RESEND_API_KEY`/Upstash, plus a paired
  loud-skip step that emits a `::warning::` and a job-summary line. The silent
  skip this story was written about is not reproduced.
- **F2** — the suite's UUIDs were not valid hex (`ib111111-…`); it had never
  executed. Fixed; now runs.
- **F3** — the with-check assertions were vacuous (the household-scope trigger
  denied the write first, so the policy was never reached). Added
  `(b-isolated)`/`(c-isolated)`, which disable that trigger for one statement.
  **Both have now been watched to fail**, and — the part worth keeping — the
  falsifying mutation is *not the same for the two*:
  `with check (true)` alone turns exactly `(b-isolated)` red;
  `(c-isolated)` needs `using (true) with check (true)`, because for a
  `for all` policy Postgres evaluates USING against the **new** row on UPDATE
  as well as the old one. The check's name and comment were corrected to claim
  "the policy denies this" rather than "the with-check clause does" — the
  original wording was an overclaim no mutation of the with-check could
  falsify.
- **F4** — Tasks 5, 6 and 7 landed: attachment rendering in `InboxList`
  (paperclip chip) and `InboxResolveDialog` (links), `InboxAttachment` in
  `types.ts`, `CaptureSection.tsx` wired into both settings surfaces with
  English **and** French catalogue entries, and the missing
  `e2e/email-ingress.spec.ts`.
- **F5** — Prettier is clean on every file in this commit.
- **F6/F7** — unknown-sender test pinned so deleting the member gate actually
  fails it; `Deno.serve`'s feature-detect now has a loud `else`.
- **F8 — the fix in the tree was wrong, and the new e2e is what caught it.**
  F8 correctly identified that the hardcoded `SB_JWT_ISSUER` broke every
  `STACK_ID != 0`, but the replacement (`new URL(req.url).origin`) is wrong in
  a worse way: inside the Edge Runtime `req.url` is the container's own
  internal listener, so every stored attachment `src` pointed at
  `http://127.0.0.1:8081/…` — reachable by nobody, on any stack, including
  stack 0 where the old code had at least worked. The e2e's byte comparison
  failed with `ECONNREFUSED 127.0.0.1:8081`. Replaced with
  `resolvePublicOrigin()`, which reads the forwarded headers Kong actually
  sends — measured on a real request: `x-forwarded-proto: http`,
  `x-forwarded-host: 127.0.0.1`, `x-forwarded-port: 54351` — and keeps
  `req.url` only as a last-resort fallback. This is the concrete argument for
  Task 7 existing at all: the mocked handler test (18/18) passes either way,
  because a mock cannot dial an unreachable host.
- **F9** — `package.json`/`package-lock.json`/`vitest.config.ts` and both
  `_shared/` shims are declared in the File List below. `vite.config.ts` is
  **deliberately excluded**: its current diff is Story 10.1's
  `generateSW`→`injectManifest` migration, which must land with 10.1's own
  push-service-worker guard, not ride in here.

**Still open, flagged not silently absorbed.**

- `make lint` is red on `src/sw.ts`, `inbox/ShareTarget.tsx` and
  `inbox/LinkToShidduchSearch.tsx` — all Story 10.1's in-progress files,
  none in this commit. Prettier formatting only; eslint passes. Not fixed
  here, because reformatting another story's uncommitted work is exactly the
  cross-agent excursion `.claude/rules/parallel-ownership.md` prohibits.
- `registry.json` was regenerated before 10.1 created
  `LinkToShidduchSearch.tsx`, so it does not list that file. That is the
  documented busy-tree behaviour; 10.1 regenerates on its own commit.
- The Cloudflare Email Routing migration and FR22's per-account inbound
  address remain out of scope, exactly as the Dev Notes above state.

### File List

**New**

- `e2e/email-ingress.spec.ts`
- `src/components/atomic-crm/settings/CaptureSection.tsx`
- `src/components/atomic-crm/settings/CaptureSection.test.tsx`
- `supabase/functions/_shared/denoEnvTestShim.ts`
- `supabase/functions/_shared/edgeRuntimeTypesStub.ts`
- `supabase/functions/postmark/index.test.ts`
- `supabase/tests/inbox_items.sql`
- `supabase/tests/inbox_items.test.ts`

**Modified**

- `.github/workflows/deploy.yml`
- `package.json`, `package-lock.json` (`base64-arraybuffer`, required by
  `extractAndUploadAttachments.ts`)
- `registry.json` (generated — `CaptureSection.tsx`)
- `vitest.config.ts` (the `functions` project's `Deno.env` shim + the
  `jsr:` type-stub alias)
- `src/components/atomic-crm/inbox/{InboxList,InboxResolveDialog}.tsx`
- `src/components/atomic-crm/providers/commons/{englishCrmMessages,frenchCrmMessages}.ts`
- `src/components/atomic-crm/settings/{SettingsPage,SettingsPageMobile}.tsx`
- `src/components/atomic-crm/types.ts`
- `supabase/functions/postmark/{index,createInboxItemFromEmail,extractAndUploadAttachments}.ts`
