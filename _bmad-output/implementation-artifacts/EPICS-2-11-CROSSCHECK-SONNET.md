# Cross-check findings — Epics 2–11 (MyShadchan)

Base: `/home/daniel/repos/myshadchan`. Sources read in full: `epics.md`, `ARCHITECTURE-SPINE.md`, `SPEC.md`, and all 59 story files `2-1-*.md` … `11-3-*.md` under `_bmad-output/implementation-artifacts/`. Epic 1 treated as fixed context only.

Overall: this story set is unusually rigorous — nearly every story self-audits its own cross-epic assumptions, names its own "Dependencies" section, and includes the exact grep/SQL to verify a prior epic actually landed what this story assumes. The defects below are the ones that survived that self-auditing, mostly because the self-auditing checked the *wrong* prior epic or didn't exist for the other side of a two-story split.

---

## 1. Cross-epic dependency errors

**1. BLOCKER — Stories 5.3/5.4/5.5 write RLS against a function Epic 2 deletes.**
`5-3-resume-tab-version-history.md` (Task 1: `(storage.foldername(name))[1] = public.current_account_id()::text`; Task 2: "validates the shidduch belongs to `current_account_id()`"), `5-4-photo-tab-explicit-visibility.md` (Task 1, predicate given twice), and `5-5-medical-tab-sensitive-tier.md` (Task 2, predicate given twice) all reference `public.current_account_id()`. Story `2-1-context-aware-authorisation.md` AC-1/AC-10 makes this function's deletion (not deprecation) a hard requirement: `select to_regproc('public.current_account_id')` must return NULL, and a repo-wide grep must return zero hits, after Epic 2. Epic 5 runs after Epic 2 (5.4/5.5 both explicitly gate on Epic 2's `single`-role addition), so any migration following these three stories literally will fail (undefined function) or silently resurrect the exact "first-row" resolver AD-19 exists to kill. By contrast, `3-5-universal-activity-tab.md` and `3-8-universal-tasks-tab.md` (also written pre-Epic-2) both carry an explicit "Epic 2 dependency — what to do if `current_context_id()` is not there yet" note and use the correct name throughout. **Fix:** rewrite the four cited predicates in 5.3/5.4/5.5 to `current_context_id()`, and add the same caveat 3.5 carries.

**2. BLOCKER — Stories 7.4 and 8.2 both `CREATE TABLE public.connections`, with incompatible shapes.**
`7-4-any-pairing-private-thread.md` builds `public.connections` itself, explicitly as shared scaffolding — its own header states "**Epic 8 Story 8.2 does NOT recreate the table**; it adds the propose/accept/end RPCs... using the table this story ships." Its schema: `status ∈ ('pending','accepted','ended')`, no `proposed_by_account_id`/`ended_by_account_id`, and a **plain** unique constraint on `(household_account_id, shadchanus_account_id)` (permanently forbidding any future reconnection after an end). `8-2-consent-based-connection.md` Task 1, written with zero reference to Epic 7/Story 7.4 anywhere in its text, independently issues its own `create table public.connections (...)` with `status ∈ ('accepted','ended')` only (no `'pending'` — that state lives in a separate `connection_invites` table instead), extra columns (`proposed_by_account_id`, `ended_by_account_id`, `connections_ended_consistency`), and a **partial** unique index scoped to `status='accepted'` (deliberately allowing a new row after an old one ends — the opposite of 7.4's constraint). Since Epic 7 precedes Epic 8, 8.2's migration collides with an object 7.4 already created. **Fix:** designate 7.4 as sole owner (it lands first, and AD-1 requires a table's RLS to ship in the same migration that creates it); rewrite 8.2 Task 1 as `ALTER TABLE public.connections` (add the missing columns/constraint, swap the unique index for the partial one) instead of `CREATE TABLE`, and reconcile the `'pending'`-on-`connections`-vs-`connection_invites` question explicitly.

**3. SHOULD-FIX — Stories 5.8/5.9 re-derive schema work Epic 3 already did.**
`5-8-single-360.md` states "Epic 3's Stories 3.5/3.6/3.8 build the universal Activity/Notes/Tasks tabs generically, but their own ACs never mention extending these enums" and proceeds to add `'single'` to `interactions_target_type_check`/`tasks_target_type_check`. This is factually wrong: `3-5-universal-activity-tab.md` AC-1 already widens `interactions_target_type_check` to `('reference','shidduch','shadchan','single')` **and** adds the `interactions_scope_link_check` branch for `target_type in ('shadchan','single')` in one pass; `3-8-universal-tasks-tab.md` AC-1 already adds `'single'` to `tasks_target_type_check`. `5-9-shadchan-360.md`'s elaborate "Ownership note" (5.8 vs. 5.9 sequencing on the same constraints) is built on the same false premise, since `'shadchan'` was already added to `interactions_target_type_check` by 3.5 too. **Fix:** 5.8/5.9 should grep the live constraint (as 5.5 correctly does for the role check) before assuming it needs widening, and drop that half of their Task 2 once they find it already done — narrowing their real remaining schema work to the `resumes`/`resume_photos` single-subject columns (5.8) and the `shadchanim.notes` migration (5.9).

**4. SHOULD-FIX — Story 6.2 redefines a function Epic 3 already built.**
`3-5-universal-activity-tab.md` Task 2 creates `public.current_member_id()` (`STABLE SECURITY DEFINER`, resolves the caller's `account_members.id` for the active context) so that `3-6-universal-notes-tab.md`'s author-editable-note RLS can call it. `6-2-row-level-scoping-for-a-single.md` Task 0/Task 1 independently defines the **same function name** from scratch, with a slightly different body (adds `order by am.id limit 1`). Its own "reuse check" only greps for the name against "Epic 2," never Epic 3, so the collision is never caught. Because `CREATE OR REPLACE FUNCTION` is silent on redefinition, 6.2 would quietly overwrite the function 3.6's RLS already depends on. **Fix:** 6.2 should reuse 3.5's `current_member_id()` unchanged and add only `current_member_role()` as new; broaden its Task-0 reuse-check to cover functions introduced by any prior epic, not just Epic 2.

**5. SHOULD-FIX (duplicate) — Stories 10.3 and 11.2 each claim to be first to add `supabase/tests/inbox_items.sql`.**
`10-3-email-ingress-verified-end-to-end.md` Task 4 ("This suite doesn't exist today") and `11-2-resume-auto-parse-review.md` AC-13/Task 6 ("No `.sql` test file today asserts `inbox_items` cross-account isolation... Add `supabase/tests/inbox_items.sql`") both independently create the identical new file, each having grepped and confirmed its absence at its own writing time — neither references the other. Epic 10 precedes Epic 11. **Fix:** 11.2 Task 6 should read "extend `supabase/tests/inbox_items.sql` (created by Story 10.3)" and add only its `/parse`-route-specific assertions.

**6. SHOULD-FIX — Story 3.3 commits Epic 4 to a design Epic 4 explicitly declines.**
`3-3-entity-descriptor-registry.md` states, resolving what it calls a flagged cross-epic split: "the list half of the AC is completed when Epic 4 Story 4.1 builds `EntityList` against this same `EntityDescriptor` type." `4-1-entity-list-framework.md`'s own Dev Notes say the opposite: "No entity descriptor integration... That registry does not exist yet as of this story; `EntityList`'s props are the contract for now... a follow-up refactor, not this story's to anticipate." No later story (5.8/5.9/5.10, which do register full descriptors) ever goes back and rewires `SingleList.tsx`/`ShadchanList.tsx`/`ReferenceList.tsx` onto them. Net effect: AD-24's "Lists render through one `EntityList`... an entity contributes a descriptor... and no bespoke layout code" is never actually delivered for the list half by the end of Epic 11 — every retrofitted list still hard-codes its own `title`/`eyebrow`/`sort` props. **Fix:** either correct-course a story to consume `EntityDescriptor.label/icon/meta` in the three retrofitted lists, or amend epics.md/AD-24 to state list-level descriptor-consumption is out of Phase-1 scope.

**7. SHOULD-FIX — epics.md's own FR-coverage map understates Epic 8/9's real dependencies (self-flagged three times).**
`8-3-in-platform-redting.md` ("Thread mirroring depends on Epic 7... a genuine cross-epic dependency that epics.md does not currently state"), `8-5-shadchans-own-crm.md` ("Epic 8's own FR coverage row in epics.md... does not mention UX-DR1/UX-DR7/AD-24 at all, yet this story cannot be built without them"), and `9-5-revocable-share-links.md` ("Epic 9's requirements coverage row... does not list this as a stated dependency anywhere in epics.md... the cleaner fix is a correct-course on the epic list itself") each independently surface the same class of gap. Each story handles it gracefully at the story level, but the planning document itself is out of date. **Fix:** correct-course epics.md's FR-coverage map: add "AD-22, Epic 7" and "UX-DR1/UX-DR7/AD-24, Epic 3/4" to Epic 8's row; add "Epic 5 Stories 5.3/5.8" to Epic 9's row.

---

## 2. Duplicated work across epics

Covered above by evidence; summarized here with ownership calls:

| What | Built by | Duplicated/conflicted by | Owner should be |
|---|---|---|---|
| `public.connections` table | 7.4 | 8.2 (finding 2) | **7.4** — 8.2 must `ALTER`, not `CREATE` |
| `interactions`/`tasks` target-type widening for `single`/`shadchan` | 3.5, 3.8 | 5.8, 5.9 (finding 3) | **3.5/3.8** — 5.8/5.9 grep first, then skip |
| `current_member_id()` | 3.5 | 6.2 (finding 4) | **3.5** — 6.2 reuses it |
| `supabase/tests/inbox_items.sql` | 10.3 | 11.2 (finding 5) | **10.3** — 11.2 extends it |

---

## 3. Gaps against the SPEC's 13 capabilities and the 24 ADs

Went through AD-1 → AD-24 individually. All 13 capabilities have at least one owning story; the gaps below are inside ADs that *are* addressed, or ADs left structurally incomplete.

**8. SHOULD-FIX — AD-1's "every table has `FORCE ROW LEVEL SECURITY`... CI asserts this" is never delivered for pre-existing tables.** `2-1-context-aware-authorisation.md` explicitly declines to do a repo-wide FORCE-RLS pass ("no story in Epic 2's stated text asks for a table-by-table FORCE-RLS audit... flagged as an AD-1 gap with no assigned story"). `7-1-thread-model.md` then asserts, incorrectly, that "that gap is Epic 2's to close repo-wide," and only applies `FORCE` to its own three new tables. Every later new-table story (8.2, 9.1, 9.5, 7.5) correctly FORCEs its own objects, but nothing in Epics 1–11 ever retrofits `FORCE` onto the ~20 tables that predate Epic 7, and no story adds the CI assertion AD-1 names. Practical risk is low (no `anon` grant survives on those tables), but the compliance requirement is explicit and unmet. **Fix:** assign a story to retrofit `FORCE ROW LEVEL SECURITY` repo-wide and add the CI check.

**9. SHOULD-FIX — AD-2's "retire `is_admin()`/`isInitialized`" is half-done.** `isInitialized` is correctly retired by 2.7. `is_admin()` is explicitly left in place by 2.1 ("flagged to the epic owner as an AD-2 directive with no assigned story — not resolved here") and never revisited by any later epic.

**10. SHOULD-FIX (functional, not a security hole) — CAP-9's permission-aware rendering rests on a hook nobody ever finishes wiring.** `3-4-permission-aware-rendering.md` builds `useViewerRole()` as an explicitly provisional stand-in, mapping the legacy `sales.administrator` boolean to `"parent_admin" | "helper"`, with a `// TODO(Epic-2)` naming `account_members.role` via `current_context_id()` as the real source. `6-2-row-level-scoping-for-a-single.md` builds exactly that missing piece — `current_member_role()` — but only as a Postgres function; no story ever exposes it to the frontend or rewires `useViewerRole.ts`. Concretely: `5-5-medical-tab-sensitive-tier.md` declares its Medical tab's `minVisibility` as `parent_admin | self_manager` using this broken hook, so by end of Epic 11 a real `self_manager` (or any `parent_admin` whose legacy `administrator` flag is false) would have the Medical tab hidden in the UI even though the database correctly grants them the data — the DB-level negative test still passes (the real security boundary holds), but the product's stated "one consistent 360° view... permission-aware rendering" promise silently doesn't. **Fix:** a story (naturally Epic 6, which already built the missing function) must expose it and rewire `entity360/useViewerRole.ts`.

**11. SHOULD-FIX — AD-9 ("all user files in R2, served only by the proxied `share/` Worker") is never satisfied for the primary in-app path.** 5.3 ships resumes on plain Supabase Storage signed URLs, explicitly stating "this story does not attempt [AD-9 compliance] and must not be read as having satisfied AD-9." 5.4 repeats this for photos. 9.5 only builds the R2/Worker-proxy path for the *external share-link* case; it never migrates the underlying resume/photo storage itself. No story anywhere closes this.

**12. SHOULD-FIX — AD-17 (rate limiting / abuse prevention) has no owning story anywhere in Epics 1–11.** 11.2 explicitly disclaims it ("a distinct, later hardening concern... not an Epic-11-specific acceptance criterion"); no other epic claims it either, despite AD-17 explicitly requiring "fail-closed on the paid AI paths."

**13. NOTE — AD-18's stated Hebrew/RTL audit ("the fork is LTR-only today, so RTL is a cross-cutting audit") has no assigned story.** Individual stories add i18n keys correctly but nobody performs the audit.

**14. NOTE — AD-15 (export / account deletion / per-single purge)** is not addressed by name in any Epic 2–11 story; likely pre-existing from the prior epic numbering per epics.md's "substantially delivered" framing, but nothing re-confirms it holds correctly under the new multi-persona/multi-context model. Flag for the epic owner to confirm rather than assume.

---

## 4. Missing negative tests

**Clean.** Every story that touches RLS or a permission boundary carries an explicit, named negative test citing `.claude/rules/security-triggers.md` directly: 2.1 (two-context isolation), 2.2 (household-scope trigger, role/context mismatch, `members` visibility), 2.5, 2.7, 2.8, 3.5, 3.6, 3.7, 5.4, 5.5, 6.1–6.5, 7.1, 7.3, 7.4, 7.5 (`push_subscriptions`), 8.2, 8.3, 8.4 (an entire story *is* the negative-test suite, plus a `pg_policies` structural regression guard), 9.1–9.3, 9.5, 10.3, 11.2. One caveat: 5.3/5.4/5.5's negative tests are written against the same wrong function name flagged in Finding 1 — once that's fixed, the tests need the identical substitution; they are not *missing*, just presently untestable as written.

---

## 5. Unresolved decisions

**15. Story 2.1 — the `members` vs. `account_members` naming collision** is explicitly punted ("Flagged again in the epic-level report for whoever owns the decision to ever actually resolve it") and never picked up by any later story.

**16. Story 2.1 — `is_admin()` retention** (same as Finding 9) is an open item for the epic owner, not a decision made.

**17. Story 2.2 — "a login holding two separate household-kind contexts"** (e.g., a single-role household member who later marries and needs their own household) is explicitly named as unresolved lifecycle territory, "flagged for the same owner, not invented here," and never revisited.

**18. Stories 8.3 / 8.5 / 9.5 — three unstated cross-epic dependencies** epics.md doesn't record (Finding 7) are, in effect, "the epic owner should confirm/decide" items, even though each story supplies a working fallback so it isn't blocking on its own.

**19. Story 10.3 — three explicitly flagged, unowned product gaps:** migrating email ingress off Postmark to Cloudflare Email Routing, hardening the `attachments` bucket's public-URL/unscoped-path design (independently also flagged by 3.7 as "this story does not fix"), and FR22's per-account private inbound address. None is assigned to any story in the current 11-epic list.

None of these makes its own story un-implementable (each supplies a safe default), but 15–19 are genuine open questions that should be resolved by the product/architecture owner before being considered fully closed.

---

## 6. Unachievable or undecidable ACs

Markedly cleaner than Epic 1's cross-check — nearly every AC across all 59 stories names an exact grep, SQL assertion, or test file. The one recurring soft spot: several stories satisfy UX-DR11's "renders empty/loading/error, light+dark, 375px" via "a manual smoke check" or "reuse the project's existing Storybook/visual setup" (3.1 Task 4 is the exception — its grep-based no-hard-pixel/no-hex-color check is genuinely automated) rather than an automated visual-regression assertion (5.1 Task 5, 8.1 Task 5, 9.4 Task 3). This is a note, not a blocker: none of these ACs are internally contradictory, just not mechanically verified to the same standard as the rest of each story.

---

## 7. Greenfield violations (NFR-14)

**Clean.** No alias, shim, fallback, redirect, or compatibility path is proposed anywhere in Epics 2–11. Every rename/replacement is one-way and explicit (e.g., 9.3's drop-and-recreate of the `Single listings insert` policy is called out precisely so it isn't mistaken for a second policy; 5.9 migrates and drops `shadchanim.notes` in the same migration). The two intentional architecture deviations (5.3/5.4's interim Supabase-Storage-not-R2 choice, Finding 11; 10.3's un-migrated Postmark path) are each a single, honestly-labeled path — not a second path kept alongside a first — so they read as scoped technical debt against AD-9/the stack table, not NFR-14 violations.

---

## Verdict per epic

- **Epic 2 (Identity):** ready-for-dev — 3 open decisions (15, 16, 17) flagged for the epic owner, none blocking.
- **Epic 3 (360° Framework):** ready-for-dev — should fix Finding 6 (EntityList/descriptor split) and 10 (`useViewerRole` wiring) before Epic 5/6 lean on them further.
- **Epic 4 (Navigation & Lists):** ready-for-dev on its own terms; is the other half of Finding 6.
- **Epic 5 (Entity 360s):** **blocked** — Stories 5.3, 5.4, 5.5 reference a deleted function (Finding 1) and cannot be implemented as written; Stories 5.8/5.9 should be corrected to avoid redoing Epic 3's schema work (Finding 3) before development starts.
- **Epic 6 (Single's Access):** ready-for-dev, modulo Finding 4 (`current_member_id()` collision) and picking up Finding 10's fix.
- **Epic 7 (Communication):** ready-for-dev on its own; is the first half of the Epic-8-blocking conflict (Finding 2).
- **Epic 8 (Shadchan Context):** **blocked** on Finding 2 (`connections` table conflict with 7.4) until reconciled; otherwise ready.
- **Epic 9 (Listings & Sharing):** ready-for-dev; Finding 18's soft dependency on Epic 5 should be recorded in epics.md but doesn't block implementation.
- **Epic 10 (Capture Funnel):** ready-for-dev; owns three explicitly-flagged, unassigned product gaps (Finding 19) worth a product decision but not blocking Epic 10 itself.
- **Epic 11 (AI Layer):** ready-for-dev, modulo the trivial Finding 5 fix; correctly handles its dependency on Epic 10's attachment shape via its own stated `[ASSUMPTION]` fallback.

**Two items must be resolved before implementation starts, everywhere else:** Finding 1 (Epic 5's `current_account_id()` references) and Finding 2 (the `connections` table conflict between Epic 7 and Epic 8).