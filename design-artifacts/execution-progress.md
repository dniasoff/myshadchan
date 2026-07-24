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
| E5 | Shadchan productivity stats | 1 | view | TODO | — | — | `shadchan_stats` view + tiles on ShadchanShow |
| E6 | Per-child pipeline counts | 1 | view | TODO | — | — | `children_summary` view + counts on ChildCard/dashboard |
| E9a | Dead route: `/tasks` → `/reminders` | 1 | none | TODO | — | — | redirect or drop tasks list route in root/CRM.tsx |
| E9b | Primary-button consistency (gradient) | 1 | none | TODO | — | — | child & reference create/edit saves |
| E9c | Desktop settings two-pane layout | 1 | none | TODO | — | — | keep MCP/inbound cards out |
| E9d | State/theme/375px parity pass | 1 | none | TODO | — | — | per-screen empty/loading/error + dark + AA |
| E3 | Dedupe/catch engine + review | 2 | keys+RPC | TODO | — | — | reuse references match-key infra; wire ShidduchCard catch slot |
| E4 | Billing + server-side entitlement | 2 | tables+fn | TODO | — | — | move useAiEntitlement server-side FIRST; $2/mo tier UI |
| E2 | Capture funnel: share→inbox→parse | 3 | inbox_items | TODO | — | — | free manual path first; AI parse behind E4 |
| E7 | Candidate portal (read-only) | 4 | tokens+RLS | TODO | — | — | uses existing `visibility` cols; SECURITY-REVIEWER |
| E8 | Onboarding cluster | 4 | maybe | TODO | — | — | 18+/invite/first-run; reskin ConfirmationRequired |

## Security-review required
E2 (external ingress + attachments), E4 (billing/entitlement), E7 (portal trust boundary).

## Event log (append-only)
- 2026-07-24 — Ledger created. Wave 1 started. Launched E1 as canary (verify sub-agent availability
  after earlier weekly-limit failures).
- 2026-07-24 — E1 DONE. Sub-agents confirmed working again. Committed to main. Next: batch A (E5+E6
  aggregates, single DB owner), B (E9a+E9c frontend polish), C (E9b button consistency) — file-disjoint.
