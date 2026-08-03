# Story 10.2: Ambiguous sender attribution

Status: ready-for-dev

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

- [ ] **Task 1 — Schema: add the confirmation flag** (AC: 2)
  - [ ] `supabase/schemas/01_tables.sql`: add `sender_needs_confirmation boolean not
        null default false` to `public.inbox_items`, next to `sender`. Update the
        table's existing header comment (currently: *"Captured `raw_text`/`attachments`
        are stored verbatim and never auto-parsed..."*) to note that `sender` is now the
        recovered original sender for email, not the SMTP envelope address.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        add_inbox_items_sender_confirmation` — a plain `ALTER TABLE ... ADD COLUMN`;
        hand-check the generated migration touches nothing else (none expected for an
        ADD COLUMN, but AGENTS.md warns generated migrations sometimes need manual
        adjustment).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset`/`db push`.
  - [ ] `06_grants.sql`: confirm no change needed — `inbox_items` already grants
        `select, insert, update, delete` to `authenticated` and `all` to
        `service_role` at the table level; a new column needs no separate grant.

- [ ] **Task 2 — Pure extraction function** (AC: 1, 2)
  - [ ] `supabase/functions/postmark/forwardedParser.ts`: add
        ```ts
        export interface OriginalSenderCandidate {
          name: string | null;
          email: string | null;
          needsConfirmation: boolean;
        }
        export function extractOriginalSender(body: string): OriginalSenderCandidate
        ```
        Algorithm (pure, no I/O — matches this file's existing style):
        1. Count occurrences of **any** `FORWARD_SEPARATOR_PATTERNS` entry across the
           *whole* body (use each pattern with a global flag over the full text, not
           just `lines[0]` as `stripForwardingHeaderBlock` does — that function only
           ever looks at the first line, which is correct for its own job of stripping
           one top-level block but insufficient for counting nested forwards).
        2. Zero matches → not a forward at all → `{name: null, email: null,
           needsConfirmation: false}` (nothing to recover; not ambiguous — there's
           simply no forwarding signal, e.g. a member composed the message themselves).
        3. Two or more matches → a forward-of-a-forward → `{name: null, email: null,
           needsConfirmation: true}` (can't know which layer is "the" original sender).
        4. Exactly one match → isolate the header block the same way
           `stripForwardingHeaderBlock` does (from the separator line to the first
           blank line), then scan those lines for a label match:
           `/^(?:From|De|Von)\s*:?\s*(.+)$/i` (the same three locales
           `FORWARD_SEPARATOR_PATTERNS` already supports — do not add more locales
           speculatively).
           - Zero "From:"-style lines found → ambiguous (`needsConfirmation: true`).
           - More than one found → ambiguous (nested forwards inside one separator
             block, or a quoted reply chain) — do not guess which line wins.
           - Exactly one found → parse it with
             `/^"?([^"<]*?)"?\s*(?:<([^<>]+)>)?$/` (trim results). A bare name with no
             `<email>` is still a confident result (`needsConfirmation: false`) — the
             mockup's "Mrs. Feldman · detected" shows a name alone.
  - [ ] `supabase/functions/postmark/forwardedParser.test.ts`: new `describe
        ("extractOriginalSender")` block covering each branch above — reuse the
        existing Gmail/Apple/Outlook/French/German fixtures already in this file for
        the "exactly one match" cases, plus new fixtures for zero matches, two nested
        `---------- Forwarded message ----------` blocks, and a header block with no
        `From:` line.

- [ ] **Task 3 — Wire it into the webhook** (AC: 1, 2, 3, 4)
  - [ ] `supabase/functions/postmark/index.ts`: capture `const rawTextBody =
        json.TextBody;` **before** the existing `TextBody =
        getForwardedMailContent(TextBody)` reassignment (that call discards the
        header block this story needs to read — extraction must run on the
        unstripped body). Call `extractOriginalSender(rawTextBody)` **unconditionally**
        for every accepted email (not just the narrow `ToFull.length === 1 &&
        firstToEmail === INBOUND_EMAIL` branch that currently gates the
        readability-stripping step — FR24 recovery is valuable on every forward, not
        only that one case).
  - [ ] After extraction, if `candidate.email` case-insensitively equals the
        forwarding member's **own** address (`memberEmail` — the post-1.2 name of
        `salesEmail`, already in scope in `index.ts`) — override to `{name: null,
        email: null, needsConfirmation: true}`. A self-referential "From:" (someone
        forwarded their own earlier message) is not useful attribution and must not
        be shown as if it were. (Do **not** compare against the in-scope list
        `memberEmails` — post-1.2 `salesEmails` — that is *every* member's email
        product-wide, and matching it would wrongly nullify legitimate recoveries.)
  - [ ] `supabase/functions/postmark/buildInboxItemPayload.ts`: change
        `InboxItemEmailInput` to accept `originalSender: OriginalSenderCandidate` in
        place of the old `sender: string | null`. Compute the row's `sender` as
        `candidate.name ?? candidate.email` (trimmed, collapsed to `null` if both are
        null) and set `sender_needs_confirmation: candidate.needsConfirmation`.
  - [ ] `InboxItemRow` — defined in `buildInboxItemPayload.ts`, only *imported* by
        `createInboxItemFromEmail.ts` — gains `sender_needs_confirmation: boolean`;
        `createInboxItemFromEmail.ts` itself needs no change.
  - [ ] `supabase/functions/postmark/buildInboxItemPayload.test.ts`: update the two
        existing tests for the new `originalSender` input shape, and add a case for
        `needsConfirmation: true` producing `sender: null,
        sender_needs_confirmation: true`.
  - [ ] Extend `supabase/functions/postmark/index.test.ts` (created by **10.3**) with
        one new scenario: a forwarded email with a clean single "From:" line → the
        inserted row has `sender` set and `sender_needs_confirmation: false`; a
        doubly-forwarded email → `sender: null, sender_needs_confirmation: true`.

- [ ] **Task 4 — Surface it in the UI** (AC: 2, 3)
  - [ ] `src/components/atomic-crm/types.ts`: add `sender_needs_confirmation: boolean`
        to `InboxItem`.
  - [ ] `src/components/atomic-crm/inbox/InboxList.tsx`'s `InboxCard`: when
        `item.sender_needs_confirmation`, render a translated "Who sent this?" string
        (`translate("crm.inbox.senderNeedsConfirmation", { _: "Who sent this?" })` —
        add the key to **both** `englishCrmMessages.ts` and `frenchCrmMessages.ts` in
        this diff; `frenchCrmMessages.ts` ends `} satisfies CrmMessages;`, so a
        missing French twin is a `make typecheck` failure, and a hardcoded JSX string
        would type-check fine while silently staying English in the French UI),
        reusing the `--attention` honey treatment `ShidduchCatchPanel.tsx` already
        establishes for "needs a human look," not an error color, instead of the
        normal `· {sender}` line.
  - [ ] `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`: same treatment in
        the raw-capture preview block; confirm the `shadchan_id` field's
        `defaultValues` are unaffected (they already come from `item.shadchan_id`,
        never `item.sender` — no auto-fill exists to remove, just confirm it stays
        that way).

- [ ] **Task 5 — Provider sync** (AC: 1, 2)
  - [ ] `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`: add
        `sender_needs_confirmation: false` to the two existing seeded `inbox_items`
        rows, and change the second (email) row's `sender` from
        `"a.shadchan@example.com"` to a name-shaped value (e.g. `"Mrs. Feldman"`) to
        demonstrate the new semantics; add a third seeded row with
        `sender_needs_confirmation: true, sender: null` so the demo shows the
        flagged state too.

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

### Debug Log References

### Completion Notes List

### File List
