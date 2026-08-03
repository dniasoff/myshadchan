# Epic 10 Adversarial Review Report

Date: 2026-08-03

Skill used: `bmad-review-adversarial-general` (closest installed match to the requested `/bmad-adversorial-review`)

## Scope Reviewed

Epic 10 stories and implementation across the current repo state, with primary focus on:

- Story 10.1: Share-target completion
- Story 10.2: Ambiguous sender attribution
- Story 10.3: Email ingress verified end to end

Commits reviewed:

- `8091252` Story 10-1: complete share-target
- `b716adb` Story 10-1 review fixes
- `df60883` Story 10-3: verify email ingress end to end
- `993ae25` Story 10-3 review fixes
- `744a526` Story 10-2: ambiguous sender attribution

Primary specs reviewed:

- [_bmad-output/planning-artifacts/epics.md](/home/daniel/repos/myshadchan/_bmad-output/planning-artifacts/epics.md:1312)
- [_bmad-output/implementation-artifacts/10-1-share-target-completion.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/10-1-share-target-completion.md:1)
- [_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md:1)
- [_bmad-output/implementation-artifacts/10-3-email-ingress-verified-end-to-end.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/10-3-email-ingress-verified-end-to-end.md:1)

## Findings

1. **Story 10.2 does not actually let the parent confirm the ambiguous sender; it only paints a badge.**

   The story says “I want to confirm who a forwarded message came from,” but the shipped UI only renders “Who sent this?” as inert text in the inbox card and dialog, with no input, no action, and no mutation path to resolve the ambiguity. That is a contract miss, not just a UX omission.

   References:

   - [_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md](/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md:1)
   - [src/components/atomic-crm/inbox/InboxList.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/InboxList.tsx:43)
   - [src/components/atomic-crm/inbox/InboxResolveDialog.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/InboxResolveDialog.tsx:232)

2. **Linking a capture with attachments to an existing suggestion drops the attachment out of every reachable user flow.**

   `resolveAsLinkToExisting()` inserts only a text note and then marks the inbox item resolved; it never carries attachments forward to `entity_files`, an interaction attachment shape, or any other durable surface. Since the inbox list only shows `status = 'unresolved'`, the attachment disappears from the only UI that can open it once linking succeeds. This breaks the “captured content as an update” promise for attachment-backed captures.

   References:

   - [src/components/atomic-crm/inbox/useResolveInboxItem.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/useResolveInboxItem.ts:60)
   - [src/components/atomic-crm/inbox/InboxResolveDialog.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/InboxResolveDialog.tsx:265)
   - [src/components/atomic-crm/inbox/InboxList.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/InboxList.tsx:159)

3. **Both resolve paths are non-atomic and will duplicate domain data on partial failure.**

   In the “new suggestion” path, `createShidduch()` happens before the inbox item is marked resolved. If the update fails after the create succeeds, the inbox item stays unresolved and the next retry creates a second shidduch. In the “link existing” path, the note insert happens before the inbox update, so a retry can append duplicate notes. Epic 10 added the shared helper but not any idempotency or transactional guard around it.

   Reference:

   - [src/components/atomic-crm/inbox/useResolveInboxItem.ts](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/useResolveInboxItem.ts:33)

4. **The email account resolver forgot the repo’s standard `status = 'active'` membership filter.**

   The rest of the codebase consistently treats archived memberships as inactive, but `resolveHouseholdAccountIdForMemberEmail()` counts every household membership regardless of status. That means an archived second household membership can falsely trip the “ambiguous, refuse” branch, and an archived-only household membership can still be selected. This is inconsistent with the schema’s lifecycle model and can misroute or reject real captures.

   References:

   - [supabase/functions/postmark/createInboxItemFromEmail.ts](/home/daniel/repos/myshadchan/supabase/functions/postmark/createInboxItemFromEmail.ts:35)
   - [supabase/schemas/01_tables.sql](/home/daniel/repos/myshadchan/supabase/schemas/01_tables.sql:226)

5. **Share-target upload ordering still leaks orphaned storage objects on transient create failures.**

   `ShareTarget` uploads the shared files first and only then creates the `inbox_items` row. If the DB create fails after one or more uploads succeed, the retry path uploads a fresh set of objects and abandons the first set with no cleanup handle. The review-fix caching only deduplicates successful row creation; it does not make the upload+create sequence durable.

   Reference:

   - [src/components/atomic-crm/inbox/ShareTarget.tsx](/home/daniel/repos/myshadchan/src/components/atomic-crm/inbox/ShareTarget.tsx:261)

6. **The commit hygiene for Story 10.1 review fixes is poor enough to be its own risk.**

   Commit `b716adb` is titled as a Story 10.1 review-fix pass, but it also drags in a large unrelated `.agents/skills/**` payload and generated assets. That materially raises review difficulty, rollback blast radius, and the chance of shipping unrelated regressions under an Epic 10 banner. For a story that already touched service workers, inbox resolution, and storage flows, that bundling is not defensible.

## Assumptions

- Epic 10 was reviewed as implemented in the current `HEAD` state and the commit set above.
- Unrelated local workspace changes were ignored unless they overlapped Epic 10 paths.

## Commit Readout

- `8091252` and `b716adb` implement Story 10.1’s share-target flow and its fix pass.
- `df60883` and `993ae25` implement Story 10.3’s email ingress and hardening.
- `744a526` implements Story 10.2’s sender-attribution work.

Strong areas:

- Service-worker handoff for share-target
- Ingress host/origin correction
- Attachment re-signing fix for expired URLs

Weak areas:

- Unresolved ambiguity UX
- Non-atomic resolve flows
- Attachment handling after “link to existing”

## Validation Notes

- I reviewed the Epic 10 planning and implementation artifacts in `_bmad-output`.
- I read the current touched files and traced file-based git history for the Epic 10 paths.
- I ran targeted Vitest commands. A subset of tests passed, but full validation in this environment was limited by a sandbox listener error:
  `listen EPERM: operation not permitted 127.0.0.1:<ephemeral-port>`.
- Because of that sandbox limitation, I could not fully validate all browser-backed or listener-dependent suites from this environment.
