# Story 10.2: Ambiguous sender attribution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to confirm who a forwarded message came from,
so that the system never guesses — and I'm never left staring at "· me@myemail.com"
on a card I forwarded myself.

## Position in Epic 10

Depends on **10.3 landing first** (see Dependencies) — it renames
`resolveAccountIdForSalesEmail` and exports the `postmark/index.ts` handler for
testing; this story builds on both. Runs on the **post-Epic-1** codebase: `sales` is
`members`, `resolveAccountIdForSalesEmail` is `resolveHouseholdAccountIdForMemberEmail`
(10.3).

## Acceptance Criteria

1. **The stored `sender` is the original sender, not the forwarder.** Today,
   `buildInboxItemPayload.ts` stores `FromFull.Email` as `sender` — the household
   member's own email, since only a known member's address is ever accepted as the
   SMTP sender. That's useless to show back to the person who just forwarded it. After
   this story, `sender` holds the **original** sender recovered from the forwarded
   message's headers (FR24: "recover the original sender from headers/quoted body") —
   e.g. "Mrs. Feldman" — when it can be recovered with confidence.

2. **A genuinely ambiguous original sender is flagged, never guessed.** When
   forwarding *is* detected but no single confident candidate can be recovered — a
   doubly-nested forward (two or more separator blocks: which layer is "the" sender
   is not decidable), no parseable "From:"-style line in the one header block, more
   than one such line, or the recovered address is the forwarding member's own — the
   item's `sender` stays `null` and a new `sender_needs_confirmation` flag is `true`.
   The Inbox UI shows this distinctly ("Who sent this?") instead of a (possibly
   wrong) name. An email with **no forwarding signal at all** is not ambiguous — the
   member composed it themselves: `sender` stays `null` and the flag stays `false`.

3. **Nothing is ever auto-attributed.** Whether confident or ambiguous, the recovered
   name is a **display hint only** — it never sets `shadchan_id` on the `inbox_items`
   row or pre-selects a value in the resolve form's shadchan field. The human always
   makes the final pick (CAP-2: no inbound path files without the confirm step).

4. **It never crosses an account boundary.** The recovered sender is only ever shown
   as free text and only ever used to *search* the current account's own shadchan
   book (`shadchanim`, RLS-scoped) — never to look up or auto-link a shadchan record
   directly, confident or not. **Negative test (decidable):** in
   `postmark/index.test.ts`, for both a confident and an ambiguous recovery, assert
   the mocked `supabaseAdmin.from` is **never called with `"shadchanim"`** and the
   inserted row carries no `shadchan_id` — the recovered value flows only into the
   `inbox_items.sender` text column.

## Tasks / Subtasks

- [x] **Task 1 — Schema: add the confirmation flag** (AC: 2)
  - [x] `supabase/schemas/01_tables.sql`: add `sender_needs_confirmation boolean not
        null default false` to `public.inbox_items`, at the physical tail (COLUMN-ORDER
        TRAP) after `connection_id`. Update the table's existing header comment to note
        that `sender` is now the recovered original sender for email.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        add_inbox_items_sender_confirmation` — a plain `ALTER TABLE ... ADD COLUMN`;
        hand-checked the generated migration touches nothing else.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
  - [x] `06_grants.sql`: confirmed no change needed.

- [x] **Task 2 — Pure extraction function** (AC: 1, 2)
  - [x] `supabase/functions/postmark/forwardedParser.ts`: added
        `export interface OriginalSenderCandidate` and `export function extractOriginalSender(body)`.
        Algorithm: count separators globally; 0 = not forward; ≥2 = ambiguous; 1 = scan
        the header block for `From/De/Von`, parse the single match with a name/email
        regex; bare emails are treated as email for self-reference checks. Added tests
        covering all branches and locales.
  - [x] `supabase/functions/postmark/forwardedParser.test.ts`: new `describe
        ("extractOriginalSender")` block with Gmail/Apple/Outlook/French/German fixtures
        plus zero-match, nested-forward, and no-From-line cases.

- [x] **Task 3 — Wire it into the webhook** (AC: 1, 2, 3, 4)
  - [x] `supabase/functions/postmark/index.ts`: captured `rawTextBody` before the
        forwarding-strip reassign; call `extractOriginalSender` unconditionally for every
        accepted email; override to ambiguous if the recovered email equals the
        forwarding member's own address (`memberEmail`); pass the candidate to
        `buildInboxItemPayload`.
  - [x] `supabase/functions/postmark/buildInboxItemPayload.ts`: changed input to accept
        `originalSender: OriginalSenderCandidate`; compute `sender` as
        `name ?? email` and set `sender_needs_confirmation`.
  - [x] `supabase/functions/postmark/buildInboxItemPayload.test.ts`: updated tests for
        the new input shape and added ambiguous case.
  - [x] Extended `supabase/functions/postmark/index.test.ts` with confident recovery,
        doubly-forwarded ambiguous, and self-reference override scenarios; asserted
        no `shadchanim` query and no `shadchan_id` on the inserted row.

- [x] **Task 4 — Surface it in the UI** (AC: 2, 3)
  - [x] `src/components/atomic-crm/types.ts`: added `sender_needs_confirmation: boolean`
        to `InboxItem`.
  - [x] `src/components/atomic-crm/inbox/InboxList.tsx` and
        `InboxResolveDialog.tsx`: render translated "Who sent this?" using the
        `--attention` honey treatment when the flag is true; normal sender line otherwise.
  - [x] Added `crm.inbox.senderNeedsConfirmation` to both `englishCrmMessages.ts` and
        `frenchCrmMessages.ts`.

- [x] **Task 5 — Provider sync** (AC: 1, 2)
  - [x] `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`: added
        `sender_needs_confirmation: false` to existing seeded `inbox_items` rows; changed
        the email row's `sender` to a name-shaped value; added a third row with
        `sender_needs_confirmation: true, sender: null`.

## Dev Notes

### Why this exists, precisely

FR24: *"Forward mode. Parent forwards → recover the original sender (shadchan) from
headers/quoted body; low-confidence flagged for confirmation (PRV-7)."*
[Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md#5.1-Email]. PRV-7: *"For email, forwarded low-confidence
original-sender recovery is flagged, never silently wrong, and an unresolved item
waits in a holding queue, never mis-attributed."* [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md#4-Trust-Privacy-Security].
AD-6 states the same rule at the architecture layer and explicitly disavows the
fork's prior behavior: *"For email, attribution resolves sender → account
deterministically; anything ambiguous/unknown → the unattributed queue, flagged, never
auto-picked across the account boundary (the fork's postmark silent-first-body-email
attribution is a behavior change, not a lift-and-shift)."* [Source:
_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-6].

**Scope boundary — read this before expanding anything.** This story is about the
*display* of a recovered original sender, not about *who is allowed to email the
account*. FR23 ("CC mode" — the shadchan's own address is the SMTP sender, auto-match
or create the shadchan) is a different, larger capability that is **not** in Epic 10's
FR coverage row (`FR27–28, FR78, PRD §13` — and §13 is auto-parse, nothing about
CC-mode [Source: epics.md#FR-Coverage-Map]) and is not
addressed here: `index.ts` still rejects any email whose SMTP sender isn't a known
member. Do not fold FR23 into this story.

**Why account resolution isn't touched here:** that fix (`accounts.kind = 'household'`
filtering, replacing the arbitrary `order by account_id limit 1`) is **10.3's**, not
this story's — it's about *which of the member's accounts receives the item*, a
different axis from *who the message was originally from*. Land 10.3 first.

### What already exists — reuse, do not rebuild

- `forwardedParser.ts`'s `FORWARD_SEPARATOR_PATTERNS` (6 patterns: Gmail / Apple Mail /
  Outlook in English, two French, one German) — reuse the array as-is for both the
  existing strip function and the new extraction function.
  Do not add new locale patterns speculatively; if a real gap is found later, that's a
  follow-up, not a blocker here.
- `ShidduchCatchPanel.tsx`'s `--attention` token treatment — the established "calm
  flag, never an error" visual language for exactly this kind of "needs your input,
  nothing is broken" state. Reuse the same CSS custom properties
  (`--attention`/`color-mix(in_oklch,var(--attention)_...)`), don't invent a new
  color.
- `buildInboxItemPayload.test.ts`'s existing AAA test shape — extend it, don't
  restructure it.

### Data shape after this story

```
inbox_items.sender                    -- recovered original sender (name or email), or null
inbox_items.sender_needs_confirmation -- true when recovery was ambiguous
```

Manual captures (`AddToInboxDialog.tsx`) and WhatsApp/SMS shares (`ShareTarget.tsx`,
Story 10.1) are **unaffected** — they already let a human type/confirm the sender
directly, so `sender_needs_confirmation` simply defaults `false` for them (no
extraction runs outside the email path).

### Testing standard

Unit tests for `extractOriginalSender` follow the existing `forwardedParser.test.ts`
`describe`/`it` structure (AAA implicit in the fixture-then-assert style already used
there). The integration test lives in `postmark/index.test.ts` (10.3), extended here —
do not create a second integration test file for the same handler. `.claude/rules/security-triggers.md`
applies (user input handling, external data parsing) — this diff should get a
SECURITY-REVIEWER pass at implementation time given it changes how untrusted email
content is parsed and attributed.

### Project Structure Notes

- Modified: `supabase/schemas/01_tables.sql` (+ generated migration),
  `supabase/functions/postmark/{forwardedParser.ts,forwardedParser.test.ts,
  buildInboxItemPayload.ts,buildInboxItemPayload.test.ts,createInboxItemFromEmail.ts,
  index.ts,index.test.ts}`, `src/components/atomic-crm/types.ts`,
  `src/components/atomic-crm/inbox/{InboxList.tsx,InboxResolveDialog.tsx}`,
  `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`,
  `src/components/atomic-crm/providers/commons/{englishCrmMessages.ts,
  frenchCrmMessages.ts}` (Task 4's new "Who sent this?" string — see Task 4).
- No new files.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Capture-Funnel-Completion]
  — Story 10.2's stated AC.
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md#5.1-Email] — FR22–FR26 (FR24 specifically governs this story).
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/prd.md#4-Trust-Privacy-Security] — PRV-7.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-6] — the fork-behavior-is-not-a-lift-and-shift
  warning this story exists to satisfy.
- [Source: mockup/MyShadchan.dc.html#L555] — "Mrs. Feldman · detected" is the
  confident-recovery UI treatment; the ambiguous case has no mockup screen and is
  spec'd fresh here from PRV-7's "flagged, never silently wrong."

## Dependencies

- **10.3 must land first**: this story depends on
  `resolveHouseholdAccountIdForMemberEmail` existing and on `postmark/index.ts`
  exporting its handler (for `index.test.ts`, created by 10.3).
- **10.1 should land first** for `InboxResolveDialog.tsx`: 10.1 refactors this file's
  submit/dismiss logic and adds the link-to-existing-suggestion section; this story
  adds an incremental badge on top. Landing 10.1 first avoids a rebase, though it is
  not a hard technical blocker (the badge is additive to the raw-capture preview
  block, not the refactored logic).
- **Epic 1** (1.1, 1.2 specifically): `sales`→`members` renames in
  `supabase/functions/postmark/*` must already be applied (verified in
  `1-2-rename-sales-to-members.md` Task list: `postmark/createInboxItemFromEmail.ts`
  and `postmark/index.ts` are explicitly in that story's file list).

## Dev Agent Record

### Agent Model Used

kilo/moonshotai/kimi-k2.7-code

### Debug Log References

- Edge function `postmark` returned `BOOT_ERROR` in the e2e stack; root cause was
  stale/corrupted function files in `.supabase-e2e/supabase/functions/`. Fixed by
  re-copying `supabase/functions` to the e2e workdir and restarting the edge runtime.
- `e2e/share-target.spec.ts` AC 8 failed because the per-word `applyFullTextSearch`
  ORs each word across all columns; "Confidential Match" matched account A's own
  "Available Match" via the shared word "Match". Fixed by renaming fixtures so the
  negative search shares no words with the positive fixture.

### Completion Notes List

- Implemented `extractOriginalSender` in `forwardedParser.ts` using the existing
  `FORWARD_SEPARATOR_PATTERNS`; added bare-email handling so self-reference checks
  work for `From: known@example.com` as well as `From: Name <email>`.
- Added `sender_needs_confirmation` at the physical tail of `inbox_items` after
  `connection_id` to avoid the column-order trap.
- Generated clean migration `20260803191227_add_inbox_items_sender_confirmation.sql`.
- Wired recovery into `postmark/index.ts` with a self-reference override and passed
  the candidate to `buildInboxItemPayload`.
- Surfaced the flag in `InboxList.tsx` and `InboxResolveDialog.tsx` using the
  `--attention` honey treatment and a new i18n key translated in both English and
  French.
- Synced FakeRest demo data and added test coverage at unit and integration levels.
- All Epic 10 e2e tests pass; migration safety guard passed; full unit suite passes;
  typecheck passes; lint passes except for the unrelated `.kilo/agent-manager.json`.

### File List

- `supabase/schemas/01_tables.sql`
- `supabase/migrations/20260803191227_add_inbox_items_sender_confirmation.sql`
- `supabase/functions/postmark/forwardedParser.ts`
- `supabase/functions/postmark/forwardedParser.test.ts`
- `supabase/functions/postmark/buildInboxItemPayload.ts`
- `supabase/functions/postmark/buildInboxItemPayload.test.ts`
- `supabase/functions/postmark/index.ts`
- `supabase/functions/postmark/index.test.ts`
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/inbox/InboxList.tsx`
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`
- `src/components/atomic-crm/inbox/InboxResolveDialog.test.tsx`
- `src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`
- `e2e/share-target.spec.ts`
