# Story 10.3: Email ingress verified end to end

Status: ready-for-dev

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
   file byte-identical to what was sent (verified by content, not just presence).

2. **A member holding more than one context never has an email mis-routed.** Since
   Epic 2 (AD-2), a member may hold a household membership *and* a shadchanus
   membership at once. The current `resolveAccountIdForSalesEmail` picks "the first
   `account_id` ascending" — exactly the arbitrary-selection anti-pattern AD-19
   eliminates from RLS, just reimplemented in a service-role Edge Function that RLS
   never touches. This story replaces it with a resolver that selects the member's
   **household**-kind account specifically — capture is a household concern, never a
   shadchanus one (AD-2: *"a shadchanus context may never contain household domain
   rows"*). **Negative test:** a member with both a household and a shadchanus
   membership always has their forwarded email land in the household account, never
   the shadchanus one, and a member with no household membership at all (e.g.
   shadchan-only) gets the existing 403 refusal rather than a wrong guess.

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
   `shidduch_catch`, `child_portal`, `billing_entitlement` — none for `inbox_items`,
   despite it holding captured personal content). A new suite proves: an account-A
   client reads only account-A's `inbox_items` rows; an account-A client cannot
   insert/update a row carrying account B's `account_id`; `service_role` (the
   webhook's identity) can insert regardless.

## Tasks / Subtasks

- [ ] **Task 1 — Fix the account-resolution anti-pattern** (AC: 2)
  - [ ] `supabase/functions/postmark/createInboxItemFromEmail.ts`: rename
        `resolveAccountIdForMemberEmail` (10.2's dependency: this is the post-1.2 name
        of the pre-Epic-1 `resolveAccountIdForSalesEmail`) to
        `resolveHouseholdAccountIdForMemberEmail`. Change the `account_members` query
        to join `accounts` and filter `accounts.kind = 'household'`:
        ```ts
        const { data: member } = await supabaseAdmin
          .from("account_members")
          .select("account_id, accounts!inner(kind)")
          .eq("user_id", member.user_id)
          .eq("accounts.kind", "household")
          .limit(1)
          .maybeSingle();
        ```
        (adjust the exact PostgREST embed syntax to whatever
        `providers/supabase/dataProvider.ts` already uses elsewhere for a filtered
        join — don't introduce a new join idiom for this one call site). A person has
        at most one household membership (personas-and-contexts.md: a single belongs
        to exactly one household this phase), so this is a deterministic selection
        among *at most one* candidate — not the "arbitrary pick among several" pattern
        AD-19 forbids.
  - [ ] Update the doc comment (currently: *"Resolve the MyShadchan account for a
        forwarding user, keyed by their `sales` email..."*) to state the household-only
        rule and cite AD-2.
  - [ ] `index.ts`: update the import and call site.

- [ ] **Task 2 — Export the handler; add the integration test** (AC: 3)
  - [ ] `supabase/functions/postmark/index.ts`: extract the `Deno.serve(async (req) =>
        {...})` body into a named, exported function (e.g. `export async function
        handleInboundEmail(req: Request): Promise<Response>`) and pass it to
        `Deno.serve(handleInboundEmail)`. Pure refactor — behavior unchanged.
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

- [ ] **Task 3 — Harden attachment naming (contained; not a privacy fix)** (AC: 1)
  - [ ] `supabase/functions/postmark/extractAndUploadAttachments.ts`: replace
        `${Math.random()}${fileExt}` with `${crypto.randomUUID()}${fileExt}` (Deno's
        global `crypto`, no new dependency). This raises the bar against filename
        guessing/enumeration; it does **not** make the bucket private (see "Explicitly
        out of scope" below — do not expand this task).

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

- [ ] **Task 5 — Surface the inbound address in Settings** (AC: 5)
  - [ ] New `src/components/atomic-crm/settings/CaptureSection.tsx` (matches the
        existing one-file-per-section pattern: `FamilySection.tsx`,
        `PrivacySection.tsx`, `PreferencesSection.tsx`): reads
        `import.meta.env.VITE_INBOUND_EMAIL`, renders it in a monospace chip with a
        copy-to-clipboard button (reuse whatever copy-button primitive already exists
        in `src/components/ui/` — check before adding a new one), plus one sentence of
        explanation ("Forward or CC any redt to this address — it lands in your own
        Inbox.").
  - [ ] Wire it into `settings/SettingsPage.tsx` and `settings/SettingsPageMobile.tsx`,
        placed after `PreferencesSection` and before `PrivacySection` (matching the
        surrounding "how I use the app" grouping already established there — confirm
        against the file's current section order before inserting).
  - [ ] If `VITE_INBOUND_EMAIL` is unset (local dev without the env var), render
        nothing rather than an empty chip — this section is informational, not a
        blocking requirement.

- [ ] **Task 6 — End-to-end test** (AC: 4)
  - [ ] New `e2e/email-ingress.spec.ts`: seed a member (via whatever helper
        `e2e/fixtures.ts` provides post-Epic-1/Epic-2 for creating an authenticated
        household member — inspect the current shape of that file rather than
        assuming pre-Epic-1 helper names, since 1.2/1.3/1.6 rewrite it), `POST` to
        `http://127.0.0.1:54321/functions/v1/postmark` with the member's email as
        `FromFull.Email`, a `TextBody`, and one small attachment (base64), using the
        Basic-Auth credentials from `POSTMARK_WEBHOOK_USER`/`POSTMARK_WEBHOOK_PASSWORD`
        and an `x-forwarded-for` header matching `POSTMARK_WEBHOOK_AUTHORIZED_IPS`
        (see the docstring examples already in `postmark/index.ts` for the exact
        payload shape). Then sign in as that member (passwordless — reuse the Epic 2
        (2.6) sign-in helper `e2e/fixtures.ts` establishes; do not hand-roll a new
        auth flow), navigate to `/inbox_items`, and assert the new card is visible with
        a link/preview to the attachment.

## Dev Notes

### Why this story exists, and what "verified" means here

The epic's own AC is narrow and concrete: *"Given the inbound address, When I forward
a message with an attachment, Then it appears in my Inbox with the attachment intact,
And an automated end-to-end test covers the path."* [Source: epics.md#Story-10.3].
This is a **hardening and verification** story on the existing, already-deployed
Postmark pipeline (per user memory: E1–E7 deployed to production under the prior
numbering) — not a rebuild.

**"Automated end-to-end test" is defined two ways here, deliberately:** (a) a
handler-level integration test (Task 2) — the practical, fast, CI-friendly proof that
the webhook's own logic is correct, following the exact mocking convention this repo
already uses for edge functions; and (b) a Playwright spec (Task 6) that drives the
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
   `postal-mime`).** `ARCHITECTURE-SPINE.md`'s stack table names Cloudflare Email
   Routing as the intended email channel, and `workers/ingest/index.ts`'s own comment
   says the email handler is *"a stub for that rule until the inbox_item schema and
   postal-mime parsing land (separate future work)."* That "separate future work" is
   a real, undone migration — but it is **not named by any story in the current epic
   list** (Epic 10's FR coverage row is `FR27–28, FR78` only; no story anywhere says
   "migrate email ingress off Postmark"). Rather than silently absorbing an
   unscoped infrastructure migration into a "verify this AC" story, this is flagged
   here and in the final report as a gap the epic list does not currently cover.
   This story verifies and hardens the **existing, working** Postmark path.
2. **Attachment storage privacy.** `extractAndUploadAttachments.ts` uploads to a
   `public: true` Supabase Storage bucket and returns a `getPublicUrl()` — an
   unauthenticated, unexpiring, unlogged URL for what may be a resume or photo
   (PRV-1 highest-sensitivity data). This directly contradicts AD-9 ("recipients
   never receive a raw or pre-signed R2 URL... access-logged") and PRV-5/PRV-8. AD-9
   is bound to the sharing/media epic (Epic 9's territory — resumes, R2, the `share/`
   Worker), not Epic 10's capture funnel. Task 3 raises the filename entropy as a
   contained, zero-risk mitigation; it does **not** close this gap. **Flag to the
   epic owner: confirm Epic 9's stories explicitly cover migrating the `attachments`
   bucket off public URLs — if they don't, this is an unassigned gap.**
3. **FR22's per-account private inbound address.** The product currently has one
   *global* inbound address (`VITE_INBOUND_EMAIL`), with attribution done entirely by
   matching the SMTP sender against a known member's own registered email — not by a
   per-account address suffix. FR22 ("each account has a private inbound address")
   isn't in Epic 10's FR coverage row either. This story surfaces the existing global
   address (Task 5) so the path is at least discoverable and usable; it does not
   build per-account addressing.

### What already exists — reuse, do not rebuild

- `supabase/functions/postmark/index.ts`'s docstring already contains two working
  curl examples (plain forward, and forward-to-shared-address) — Task 6's e2e POST
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
  extractAndUploadAttachments.ts}`, `settings/{SettingsPage.tsx,SettingsPageMobile.tsx}`.
- No schema/migration in this story (it consumes `accounts.kind`, added by Epic 2 —
  verify that column exists before starting Task 1; if Epic 2 hasn't actually added
  it yet in the branch this is implemented against, that is a blocking prerequisite,
  not something to work around with a fallback query — NFR-14).

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
- [Source: ARCHITECTURE-SPINE.md#AD-19] — the arbitrary-selection anti-pattern this
  story closes in the service-role path.
- [Source: ARCHITECTURE-SPINE.md#AD-2] — `accounts.kind ∈ household | shadchanus`;
  "a shadchanus context may never contain household domain rows."
- [Source: ARCHITECTURE-SPINE.md#AD-6] — Cloudflare Email Routing as the target
  channel; the explicit "separate future work" flag this story does not resolve.
- [Source: ARCHITECTURE-SPINE.md#AD-9] — media/attachment privacy, flagged as Epic
  9's concern.
- [Source: workers/ingest/index.ts] — the stub comment confirming the Cloudflare
  migration is real, undone work with no assigned story.
- [Source: _bmad-output/implementation-artifacts/1-2-rename-sales-to-members.md] —
  confirms `postmark/createInboxItemFromEmail.ts` and `postmark/index.ts` already
  carry the `members`/`resolveAccountIdForMemberEmail` naming by the time this story
  starts.

## Dependencies

- **Epic 1** (1.1, 1.2): fossil `postmark/` modules deleted, `sales`→`members` applied
  to the surviving `postmark/` files.
- **Epic 2** (at least the schema portion adding `accounts.kind`): Task 1 hard-depends
  on `accounts.kind` existing. If not yet landed, this story is blocked on it — do not
  substitute a heuristic.
- This story **must land before 10.2** (renamed function, exported handler, new test
  file 10.2 extends).
- No dependency on **10.1**.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
