# Gap Remediation — Execution Progress Ledger

**Durable state for resuming across session disruptions.** Source plan:
`design-artifacts/gap-remediation-plan.md`. Work is done on the **`main`** branch (no worktrees),
implemented by capped sub-agents (**max 3 in parallel**), verified and committed by the main session.

## How to resume (fresh session)
1. Read this file — the **Status** column is the source of truth.
2. Run `git log --oneline -20` and `git status` to see what has landed on `main`.
3. Pick the next `TODO` task whose dependencies are all `DONE`; respect the ≤3-parallel cap.
4. After a task: run `npm run typecheck`, update its row here, and commit on `main`.

Status legend: `TODO` · `IN_PROGRESS` · `REVIEW` (agent done, awaiting verify) · `DONE` · `BLOCKED`.

## Waves & dependencies
- **Wave 1** (independent): E1, E5, E6, E9 — can run in parallel (≤3 at a time).
- **Wave 2** (foundations): E3, E4 — start after Wave 1 capacity frees.
- **Wave 3**: E2 — depends on E3 (catch) + E4 (paid AI parse).
- **Wave 4**: E7, E8 — independent, after their migrations.

---

## Task ledger

| ID | Epic / task | Wave | Migration? | Status | Owner | Commit | Notes |
|----|-------------|------|-----------|--------|-------|--------|-------|
| E1 | Hebrew/RTL — shidduch profile only | 1 | none | DONE | agent:epic1 | committed | typecheck ✓ + visual ✓ (profile shows EN+HE, board stays English). Files: index.css + ShidduchShowHeader/FactsCard/SchoolsSection/Inputs + heebo dep |
| E5 | Shadchan productivity stats | 1 | view | DONE | agent:aggregates | f17909f | `shadchan_stats` view + 3 tiles on ShadchanShow (Suggestions/Progressed/Reached-yes). "led to dates" omitted (no honest field). typecheck+tests ✓, visual ✓ |
| E6 | Per-child pipeline counts | 1 | view | DONE | agent:aggregates | f17909f | `children_summary` view + "N in pipeline" on ChildCard (secondary useGetList). fakerest emulated + test. visual ✓ (Rivky 3 / Yaakov 2) |
| E9a | Dead route: `/tasks` → `/reminders` | 1 | none | DONE | agent:polish1 | 13008f7 | root/CRM.tsx: Navigate redirect /tasks→/reminders (desktop); mobile list kept |
| E9b | Primary-button consistency (gradient) | 1 | none | DONE | agent:buttons | 18e4776 | FormToolbar SaveButton → PRIMARY_CTA_CLASSNAME; child/reference forms route via FormToolbar |
| E9c | Desktop settings two-pane layout | 1 | none | DONE | agent:polish1 | 13008f7 | settings/SettingsPage.tsx: max-w-4xl 2-col grid; MCP/inbound already absent |
| E9d | State/theme/375px parity pass | 1 | none | TODO | — | — | per-screen empty/loading/error + dark + AA |
| E3 | Dedupe/catch engine + review | 2 | keys+RPC | DONE | agent:catch | c9bfcee | Reused identity_signals matcher (AD-5); catch_shidduch RPC; card chip + detail panel + dashboard feed; RPC verified end-to-end + tests + visual |
| E4 | Billing + server-side entitlement | 2 | tables+fn | DONE | agent:billing | 69320e3 | Server-authoritative ai_entitlement(); RLS SELECT-only; live bypass attempts blocked; 130 DB + 12 FE tests. SECURITY-REVIEW running (agent:secreview). |
| E4f | Neutralize decoy accounts.plan/subscription_status/stripe_* cols | 2 | grants | DONE | agent:decoy | 4c234ab | revoked table UPDATE, re-granted (name,transparency_level,data_region); accounts.plan write now refused (verified) |
| — | NOTE (Epic-10): AI inference edge fns MUST re-call ai_entitlement() server-side | — | — | NOTE | secreview | — | client gate is UX-only; real budget protection lives server-side when inference ships |
| E2-core | Capture funnel: schema + inbox + upload + share-target + resolve/link | 3 | inbox_items | DONE | main (solo) | 10e77f7, 0e590fa | inbox_items table + RLS (verified: account_id auto-set, spoof/anon blocked) + Inbox UI + Add-to-inbox + PWA share-target(text) + resolve→createShidduch (E3 catch fires). typecheck/lint/tests ✓, visual ✓ |
| E2-email | Email-webhook ingress (repurpose postmark → inbox_items) | 3 | none | TODO | — | — | deferred from E2-core; edge-function work, service_role write |
| E2-parse | "Confirm the details" heuristic field extract (prefill resolve form) | 3 | none | TODO | — | — | resolve dialog already IS the confirm screen; this adds draft auto-fill. Gated/lower value now |
| E2-ai | AI/OCR resume extraction (real inference) | 3 | edge fn | DEFERRED | — | — | needs AI provider/gateway + keys + cost decision (Epic-10). Out of scope of this run. |
| E7 | Candidate portal (read-only) | 4 | tokens+RLS | TODO | — | — | uses existing `visibility` cols; SECURITY-REVIEWER |
| E8 | Onboarding cluster | 4 | maybe | TODO | — | — | 18+/invite/first-run; reskin ConfirmationRequired |

## Security-review required
E2 (external ingress + attachments), E4 (billing/entitlement), E7 (portal trust boundary).

## Event log (append-only)
- 2026-07-24 — Ledger created. Wave 1 started. Launched E1 as canary (verify sub-agent availability
  after earlier weekly-limit failures).
- 2026-07-24 — E1 DONE. Sub-agents confirmed working again. Committed to main. Next: batch A (E5+E6
  aggregates, single DB owner), B (E9a+E9c frontend polish), C (E9b button consistency) — file-disjoint.
