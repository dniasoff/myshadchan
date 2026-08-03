# Plan: Orchestrate, review and deploy the remainder of Epic 10

## Goal

Bring Epic 10 (Capture Funnel Completion) to a deployed, green state: verify 10.1 and 10.3 are truly complete, implement 10.2, and push everything through CI/CD.

## Context from previous session

- Previous session: `delegated-swimming-stallman` orchestrating Epic 10 via BMAD/WDS agents.
- Already committed and pushed on `main`:
  - Story 10.3: `df60883`, review fixes `993ae25`
  - Story 10.1: `8091252`, review fixes `cc4d7ba`, `b716adb`
- Story 10.2: `10-2-ambiguous-sender-attribution.md` is `ready-for-dev` and unstarted.
- Story files for 10.1 and 10.3 still list `Status: review`; the 10.3 notes mention `make lint` was red on 10.1 files and `registry.json` was missing 10.1 entries. Those items appear resolved in the current tree (`b716adb` formatted the files and `registry.json` now lists `LinkToShidduchSearch.tsx`).

## Current tree state

- Branch: `main`
- Uncommitted: preliminary edits to `supabase/schemas/01_tables.sql` (added `sender_needs_confirmation` and updated table comment) from the earlier planning turn.
- `registry.json` is up to date for 10.1 files.
- Lint currently only fails on `.kilo/agent-manager.json` (unrelated to Epic 10).

## Phase 1 — Verify 10.1 and 10.3 are closed

- [ ] Run `make typecheck`.
- [ ] Run `make test` (focus on postmark, share-target, and inbox tests).
- [ ] Run `make lint` and fix any Epic-10-related issues (ignore `.kilo/agent-manager.json` unless instructed).
- [ ] Run the e2e suite, at minimum `e2e/share-target.spec.ts` and `e2e/email-ingress.spec.ts`.
- [ ] If any test or lint failure is rooted in 10.1 or 10.3 code, fix it and commit under a "Story 10.x review fixes" message.
- [ ] Update story file statuses:
  - `_bmad-output/implementation-artifacts/10-1-share-target-completion.md`: `Status: done`
  - `_bmad-output/implementation-artifacts/10-3-email-ingress-verified-end-to-end.md`: `Status: done`
  - Fill Dev Agent Record sections if they remain empty.
- [ ] Regenerate `registry.json` if any 10.1/10.3 file changed (`make registry-gen`).

## Phase 2 — Implement Story 10.2

- [ ] Database schema + migration:
  - Ensure `supabase/schemas/01_tables.sql` adds `sender_needs_confirmation boolean not null default false` after `sender` and updates the header comment.
  - Generate migration: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_inbox_items_sender_confirmation`.
  - Hand-check the generated migration only touches `inbox_items` with `ALTER TABLE ... ADD COLUMN`.
  - Apply: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
  - Confirm `06_grants.sql` needs no change.
- [ ] Edge-function extraction logic in `supabase/functions/postmark/forwardedParser.ts`:
  - Export `OriginalSenderCandidate` interface.
  - Export `extractOriginalSender(body: string)` using the spec algorithm (count separators globally; 0 = not forward; ≥2 = ambiguous; 1 = scan header block for `From/De/Von`, parse single match).
  - Add tests in `forwardedParser.test.ts`.
- [ ] Update `supabase/functions/postmark/buildInboxItemPayload.ts`:
  - Accept `originalSender: OriginalSenderCandidate` instead of `sender: string | null`.
  - Compute `sender` as `candidate.name ?? candidate.email` and set `sender_needs_confirmation`.
- [ ] Update `supabase/functions/postmark/buildInboxItemPayload.test.ts`.
- [ ] Update `supabase/functions/postmark/index.ts`:
  - Capture `rawTextBody` before forwarding chrome is stripped.
  - Call `extractOriginalSender` unconditionally for accepted emails.
  - Override to ambiguous if recovered email equals the forwarding member's own address (`memberEmail`).
  - Pass candidate to `buildInboxItemPayload`.
- [ ] Extend `supabase/functions/postmark/index.test.ts`:
  - Confident recovery scenario.
  - Ambiguous (doubly-forwarded) scenario.
  - Negative tests: no `shadchanim` query, no `shadchan_id` on inserted row.
- [ ] Frontend type + UI:
  - Add `sender_needs_confirmation: boolean` to `InboxItem` in `types.ts`.
  - In `InboxList.tsx`, render translated "Who sent this?" with `--attention` styling when flag is true.
  - In `InboxResolveDialog.tsx`, apply the same attention treatment in the preview block.
  - Add `crm.inbox.senderNeedsConfirmation` to both i18n catalogues.
- [ ] FakeRest demo data in `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`:
  - Add `sender_needs_confirmation: false` to existing rows.
  - Change email row `sender` to `"Mrs. Feldman"`.
  - Add a third row with `sender_needs_confirmation: true` and `sender: null`.
- [ ] Update `_bmad-output/implementation-artifacts/10-2-ambiguous-sender-attribution.md`:
  - Mark `Status: done`
  - Fill Dev Agent Record.
- [ ] Regenerate `registry.json` if needed.

## Phase 3 — Pre-deploy validation

- [ ] `make typecheck` passes.
- [ ] `make test` passes.
- [ ] `make lint` passes (or only the unrelated `.kilo/agent-manager.json` remains red).
- [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local` applies cleanly.
- [ ] `make check-migration-safety` passes for the 10.2 migration.
- [ ] Run e2e for Epic 10: `e2e/share-target.spec.ts` and `e2e/email-ingress.spec.ts`.
- [ ] Run column-order check if the schema changed: `npm run test:unit:db -- column_order`.

## Phase 4 — Commit and push

- [ ] Stage and commit Phase 1 fixes (if any) with clear messages.
- [ ] Commit Story 10.2 with a message matching the repo style.
- [ ] Push `main` to `origin`.
- [ ] Monitor the `deploy.yml` run and confirm:
  - Supabase migrations deploy.
  - Edge functions deploy.
  - No worker-deploy blockers (Epic 10 has no Worker changes, so this should be a no-op).
- [ ] After deploy, verify inbound email still works and share target still works in production if possible.

## Out of scope

- Epic 11 and 12 work.
- FR23 "CC mode" (shadchan's own address as SMTP sender).
- Cloudflare Worker secret provisioning (G1) — Epic 10 does not touch workers.
- Any new features beyond the three Epic 10 stories.

## Risks

1. **Column-order trap**: adding `sender_needs_confirmation` after `sender` must match the DB's physical order; verify with `npm run test:unit:db -- column_order`.
2. **Empty-table trap**: the 10.2 migration is additive with a safe default; still run `make check-migration-safety`.
3. **Cross-story file collisions**: 10.2 touches `InboxResolveDialog.tsx` and i18n catalogues that 10.1 also edited; ensure 10.1 is fully committed and green first.
4. **Translation parity**: missing French twin for `crm.inbox.senderNeedsConfirmation` fails `make typecheck`.
5. **Self-reference override**: must compare recovered email to `memberEmail` only, not the full `memberEmails` list.

## Open questions

None — the scope is clear. The only decision already made is that this plan covers the full Epic 10 closeout (review 10.1/10.3, implement 10.2, deploy) rather than only Story 10.2.
