# Epic 13 — Open Decisions

The fifteen product calls that block Epic 13. Ten belong to Story 13.1 (sharing a child across
two households), five to Story 13.2 (when someone leaves the household).

**This file is the index; the story files hold the full reasoning.** Each entry links back to the
section it came from — `13-1-sharing-a-child-across-two-households.md` §3.x and
`13-2-when-someone-leaves-the-household.md` §3.x. If an answer here changes, the story section
changes with it, in the same edit (`.claude/rules/parallel-ownership.md` — "a shared decision has
exactly one owner").

**These are product calls, not engineering ones.** None of them should be settled by whoever
builds the story. Each changes *what* gets built, not merely how.

Status: `OPEN` · `DECIDED` · `RECOMMENDED (awaiting confirmation)`.
Every entry below is `OPEN`. Recommendations are given where there is one; several have none on
purpose.

---

## How to answer these — the order matters

They are not independent. Answering them out of order produces answers that have to be revisited.

**First — the authority chain (13.1).** E13-D1 → E13-D3 → E13-D4. Who holds the power to remove
someone, what happens when it is the holder who leaves, and whether two equals can remove each
other. The second and third only have answers once the first does.

**Second — the shape (13.1).** E13-D6 (view or edit) and E13-D8 (where the shared child appears).
Together these fix what almost every screen looks like and what the schema has to support.
Everything else in 13.1 is detail by comparison.

**Third — the boundaries (13.1).** E13-D9 (what of the sensitive tier crosses) and E13-D10 (what a
collaborator may not do).

**Fourth — the rest of 13.1.** E13-D5 (notification), E13-D7 (what a copy is), E13-D2
(reinstatement).

**Fifth — 13.2.** E13-D15 first, because it determines whether 13.2 waits on 13.1 at all. Then
E13-D14 (it reverses a shipped decision), E13-D13, E13-D11, E13-D12.

---

# Story 13.1 — Sharing a child across two households

## E13-D1 — How is "the initial admin" identified? · **OPEN**

*13-1 §3.1*

**Established.** `public.accounts` has **no creator column of any kind** — no `created_by`, no
`creator_id`. The founding member is derivable but not stored: `add_persona()` provisions a
context at three sites and omits `invited_by` at all three (→ NULL), while `accept_invite()`
copies `invites.invited_by` (→ non-null). So `account_members.invited_by IS NULL` means "arrived
without a named inviter" — a tighter derivation than lowest-id, with two holes: the platform-ops
genesis-seed path also produces NULL, and **nothing enforces at-most-one such row** (no index, no
constraint).

**Decide.** (a) Derive at read time from `invited_by IS NULL`; (b) add a stored
`accounts.founding_member_id`, backfilled once from that derivation. And separately: **is the
founder even the right authority** — or should ejection require any `parent_admin`, two of them,
or the agreement of both?

**Recommendation.** (b) — record it. A derived answer that shifts when a row is archived is the
wrong substrate for "who may eject whom". No recommendation on the second half; it has no
technical answer.

**Answer:**

---

## E13-D2 — Can an ejection be undone, and can access be re-granted later? · **OPEN**

*13-1 §3.2*

**Established.** The product's posture elsewhere is that severance is reversible in *shape*:
`connections` keeps ended rows and its unique index is partial (`where status = 'accepted'`)
specifically so a pair can reconnect. But `remove_persona()`'s own guard comment states plainly
that **"there is no un-archive path today"** — the product has never built a reinstatement
anywhere.

**Decide.** Is a re-grant a brand-new grant (clean, no memory of the old one) or a reinstatement
of the old one (with its history)? Does the ejected party have to accept again?

**Recommendation.** None. Both are defensible and the choice is about what the family should see,
not about the schema.

**Answer:**

---

## E13-D3 — What if the initial admin is the one leaving? · **OPEN**

*13-1 §3.3*

**Established.** Nothing in the schema anticipates it. `guard_persona_removal()` refuses only the
narrow case of *the account's last active member, with domain data* — a founder leaving a
household that still has another admin passes silently, and would today leave whatever authority
E13-D1 attaches to "founding member" pointing at an archived row.

**Decide.** Does the authority transfer (to whom, chosen by whom?), lapse, or block the departure?

**Recommendation.** None until E13-D1 is settled — this answer is downstream of it.

**Answer:**

---

## E13-D4 — If both are `parent_admin`, can the ejected party eject back first? · **OPEN**

*13-1 §3.4*

**Established.** Both hold identical rights today: `is_owning_membership_role()` returns true for
`parent_admin` and `self_manager` alike, and there is no seniority anywhere in the schema. Two
parents in one household, both admins, each able to remove the other, is a race — and the loser
of the race is a person who has just lost access to their child's record.

**Decide.** Does E13-D1's authority make this asymmetric? Is there a waiting period? Is the other
party told before it takes effect? Or is mutual ejection simply allowed, first-writer-wins?

**Recommendation.** None. This is the sharpest human-consequence question in the epic and the
right answer depends on a judgement about people, not about locking.

**Answer:**

---

## E13-D5 — Is the other party told, on grant and on sever? · **OPEN**

*13-1 §3.5*

**Established.** There is a notification substrate (`message_notifications`,
`fan_out_message_notifications()`, the `cron/` Worker) but it is thread-scoped; nothing today
notifies about an access change.

**Decide.** Notify on grant — surely yes, they cannot use access they do not know about. Notify on
sever is the hard one.

**Deliberately no recommendation.** Silent removal means finding out by opening the app and seeing
your child gone, which is cruel. An email saying "your access to X has been removed" arriving in
the middle of the worst month of someone's life is also a decision, not a default. **Worth
thinking about as a person, not as a feature flag.**

**Answer:**

---

## E13-D6 — View only, or edit? · **OPEN**

*13-1 §3.6* · **Shape-fixing — answer early**

**Established.** "Collaborate" and "each other's updates" read as edit. Edit across the boundary
is materially harder: the composite `(account_id, single_id)` FKs stamp every row about a child
with the *owning* household's `account_id`, so a collaborator writing a note is writing a row
carrying another account's id — which no policy in the tree permits today and which
`set_account_id_default()` actively works against.

**Decide.** Read-only, or read-plus-write? If write: **who is the author of a cross-household
note?** `interactions.actor_member_id` is resolved by `current_member_id()` from the caller's
active context, which for a collaborator resolves to a membership in the *other* household.

**Recommendation.** Read everything, write *some* — where "some" is the collaborative surface
(notes, reminders, call logs, references) and "none" is the structural surface (the child's own
identity row, publication, share links, inviting the child to a login — see E13-D10).

**Answer:**

---

## E13-D7 — What does "a copy" mean for documents on sever? · **OPEN**

*13-1 §3.7*

**Established, and it constrains the answer.** Rows can be copied cheaply. **Files cannot be
copied by reference at all** — the `documents` bucket key grammar is `{account_id}/...` and every
storage policy compares that segment to `current_context_id()`, so a row copy alone leaves the
departing household with rows pointing at object keys their policies deny.

**Decide — three possible answers, each a real product choice.**
(a) **Rows only** — the departing household loses the resume PDFs and photos.
(b) **Rows plus byte-level duplication** into the receiving account's prefix — doubles storage for
every shared child and creates a second, divergent set of files from that moment.
(c) **An export bundle** — a download, not a live record. Precedent exists in
`settings/exportFamilyData.ts`, though it is JSON-only, covers four resources, and includes no
files at all.

**Recommendation.** None. The three differ in what a family walks away with, which is the point.

**Answer:**

---

## E13-D8 — Where does the shared child appear for the collaborating parent? · **OPEN**

*13-1 §3.8* · **Shape-fixing — answer early. Probably the largest UX consequence in the epic.**

**Established.** AD-19 allows one active context at a time (`member_state.active_account_id`,
resolved by `current_context_id()`), and the accepted cost is recorded in the spine: *"one active
context per user, not per browser tab."*

**Decide — two shapes.**
(a) The shared child appears **inside the collaborator's own household**, listed alongside their
own children and marked as shared. Simple to reach; puts a row belonging to another account into a
list that is otherwise entirely their own.
(b) The shared child appears via a **context switch** into the granting household, filtered to
that one child. Structurally cleaner; the switcher then lists something that is not really a
household of theirs, and every screen is a household they do not own.

**Recommendation.** None. It determines what almost every screen looks like and both have real
costs.

**Answer:**

---

## E13-D9 — Sharing a child shares everyone the child's shidduchim mention · **OPEN**

*13-1 §3.9*

**Established, and it needs saying out loud before this ships.** A child's record is not only
about the child. Their shidduchim name a suggested person, that person's parents, their seminary,
their community. Their references are real people who spoke candidly on the understanding that
one family was listening. Granting a second household access to a child grants access to all of
it. That is probably correct and probably unavoidable — you cannot co-parent a shidduch while
seeing half of it — but **it should be a decision that was made, not one that happened.**

**Decide, specifically:**
- **`shidduchim.close_reason`** — the one column `authenticated` may not `SELECT` at all; candid
  decision rationale, reachable only through `shidduch_close_reason()`. Does a collaborator get it?
- **`medical_notes`** (Story 5.5's sensitive tier) and **`private_parent` photos** (Story 5.4) —
  deliberately narrower than account-wide. Does a collaborator get them?
- **Private threads** are participants-only by AD-22 resolution rule 1 ("private beats scope"), so
  a collaborator would **not** see them without being added. Confirm this as deliberate rather
  than discovered.

**Recommendation.** Confirm the private-thread exclusion as deliberate — it is the escape valve
that makes shared-by-default liveable. No recommendation on the other three.

**Answer:**

---

## E13-D10 — What the collaborating household may *not* do · **OPEN**

*13-1 §3.10*

**Established.** Three powers are currently gated on being the child's manager, and each would
silently widen if a collaborator were treated as one:
- **Publish the child** — AD-21: *"Only the manager of a single may publish that single's listing
  (FR103)."*
- **Mint a share link** — restricted to `parent_admin`/`self_manager` because the row contains a
  bearer token the Worker honours with service-role rights.
- **Invite the child to their own login** — `create_invite()` with `target_single_id`, which binds
  `singles.member_id` and is a one-time, unrepeatable act.

Plus one that is billing rather than dignity: **`ai_entitlement()` is per-account.** If the
granting household pays and the collaborating one does not, whose entitlement applies to AI work
on the shared child? The question has no answer today because the situation cannot arise.

**Recommendation.** No to all three powers, each enforced in the database rather than by hiding a
button. No recommendation on the entitlement question.

**Answer:**

---

# Story 13.2 — When someone leaves the household

## E13-D11 — What happens to a removed person's open shidduchim? · **OPEN**

*13-2 §3.1*

**Established.** The pipeline has no state for this. `pipeline_state` is the one canonical enum of
seven (`new · look_into · not_sure · for_sure_not · yes · unsure · no`), decision states reachable
only from `look_into`. None of the seven means "this stopped for a reason that is not about this
shidduch". `for_sure_not` and `no` both mean *we decided against this person* — which would write
a lie into the record of a shadchan who did nothing wrong, and would corrupt that shadchan's own
statistics (`shadchan_stats` counts `nb_reached_yes` / `nb_progressed` off exactly these states).

**Decide.**
(a) Leave them exactly as they are, open forever — honest, but the board shows work nobody will do.
(b) An eighth pipeline state — an AD-4 amendment touching the transition guard, the board, the
summary views and the shadchan stats.
(c) Leave the state alone and let the **single's** archived status carry it — shidduchim stay
`look_into`, but their single is archived and they fall out of the working board with their
history intact.

**Recommendation.** (c). It adds no state, tells no lie about any shadchan, and matches the
existing shape. Depends on E13-D14's answer about lists.

**Answer:**

---

## E13-D12 — Do they still appear in a sibling's record, in past redts, in reference history? · **OPEN**

*13-2 §3.2*

**Established.** Almost certainly yes, and it is the whole reason for archiving rather than
deleting — that history is about other people too. A reference call logged against a sister's
shidduch is a record of what a real person said on a real day; it does not become false when she
leaves. Nothing in the schema would remove any of it: `interactions`, `redts`,
`reference_links.conversation_log` and every note carry no reference that archiving would sever,
and `purge_polymorphic_dependents()` fires only on a **hard delete**, which 13.2 never performs.

**Decide — narrower than it looks.** Not *whether* they appear, but *how they read*. Does a
mention of an archived person carry a visible marker, or does it read exactly as it did? A marker
is honest and may also be a small unkindness every time somebody opens the file.

**Recommendation.** Mark the person's own record, not every mention of them.

**Answer:**

---

## E13-D13 — How does undo work, and for how long? · **OPEN**

*13-2 §3.3*

**Established.** **The product has no un-archive path anywhere.** `remove_persona()`'s guard
comment says so in writing, and the absence is load-bearing in existing code:
`guard_persona_removal()` refuses to archive a last remaining membership *because* `add_persona()`
would then mint a brand-new empty account rather than reactivating the archived one.
`SingleInputs.tsx` disables `archived` in the status select so it "can never be chosen going the
other way". Undo is new work, not a toggle.

**Decide.** (a) Unlimited — restorable at any time by anyone who could have removed them;
(b) time-boxed — a window of days, after which it needs support; (c) unlimited but quiet —
restorable only from the archived person's own record, never offered as a banner.

**Recommendation.** (a), unlimited. A time limit exists to protect the system from something;
nothing here needs protecting from a family changing its mind two months later, and a deadline on
undoing a bereavement notice is a cruelty with no compensating benefit.

**Answer:**

---

## E13-D14 — Do removed people appear in lists by default? · **OPEN**

*13-2 §3.4* · **Reverses a shipped decision — see the amendment note**

**Established, and this is the surprising one.** Archived singles appear in the roster **today, by
deliberate decision**. `SingleList.tsx` applies no status filter; `singles_summary` selects
`c.status` but never filters on it; and `SingleCard.tsx:23-25` carries the reasoning in a comment
— *"2.5 AC-8: this roster keeps showing archived singles (the full family record, not just the
active ones), so the status pill must say 'Archived'"*.

That was decided for a household with one self-archived persona. It is a different question for a
family whose daughter has died, who will now see her name in the list every time they open the
app.

**Decide.** (a) Keep the current always-visible behaviour — the family record is the family
record; (b) hide archived people behind a deliberate "show past members" control — they are there
when you go looking, not when you are working; (c) make it the household's own choice.

**Recommendation.** (b), with the control labelled "past" rather than "archived". But this
reverses a shipped, deliberate decision and therefore belongs to the owner.

**Amendment note.** If this changes, it changes the meaning of Story 2.5 AC-8, and
`2-5-persona-lifecycle-changes.md` is amended in the **same dispatch** — never split "update the
decision" and "update the story that describes it" across two agents
(`.claude/rules/parallel-ownership.md`).

**Answer:**

---

## E13-D15 — Are removing a person and revoking their access one action or two? · **OPEN**

*13-2 §3.5* · **Answer first among 13.2's five — it determines whether 13.2 waits on 13.1**

**Established.** They are currently two different tables meaning two different things, and neither
is reachable by anyone but the person themselves:
- `account_members.status ∈ ('active','archived')` — membership of *this household*. Archiving it
  fails closed: `current_context_id()` requires `status = 'active'`, so an archived member's
  active context resolves to NULL and every RLS policy denies. This is what `remove_persona()`
  writes.
- `members.disabled` — the login itself, across the whole product. A person may hold memberships
  of several contexts (AD-2), so disabling their login because they left *one* household would cut
  them off from a shadchanus context or their own record that has nothing to do with this family.

**Decide.** One act with two outcomes, or two separate acts?

**Recommendation.** **Two outcomes from one act, not two acts.** One neutral action removes the
person from this household; their login is untouched, because it is not this household's to
disable. And the same action asks the one permission question the "app does not ask why"
constraint permits: **does this person keep access to a child?**

**Coupling to 13.1.** That second question only has a meaningful answer once per-child
cross-household access exists. If 13.1 is deferred, "keeps access" would mean "keeps their
household membership" — which hands them the whole household, the exact thing 13.1 exists to
prevent. That is not a smaller version of the promise; it is a different and worse one. The honest
interim is to ship 13.2 **without** the access question and add it when 13.1 lands.

**Answer:**

---

## What is not open

Recorded here so it does not get re-litigated alongside the fifteen.

**Settled by the owner, for 13.1:** shared by default with the option to sever; both households see
the same live records and each other's updates; either side may later cut the link, taking a copy
of what they could then see; the household's initial admin can eject a parent **and** chooses
whether that person keeps access; access is per-**child**, never per-household.

**Settled by the owner, for 13.2:** archive, never erase; it must be undoable; and the hard
constraint — **the interface never names a reason and never offers one to choose from.** One
neutral action; the app does not ask why. Not a nullable column, not an optional field, not a
free-text box, not branching copy. An optional field still asks; the question is not asked. The
only thing the app may ask is whether the person keeps access to a child (E13-D15) — a permission
question, phrased as a permission.

**Settled by investigation** (fact, not preference — full detail in the story files):

- `public.accounts` has no creator column; the founding member is derivable, not stored (E13-D1).
- `connections` cannot carry cross-household sharing — household↔shadchanus by column name and by
  `enforce_connection_kinds()`, and AD-20's promise is the opposite of what 13.1 needs. Its
  *invitation* shape (`connection_invites`: hashed token never stored raw, expiry, status
  lifecycle, one function per verb) is the right precedent to copy.
- `share_links` cannot carry it either — bearer token, anonymous reader, read-only, expiring.
- A child's subtree is welded to one account by composite `(account_id, single_id)` foreign keys,
  so what has to change is the **reachability** rule, not the scoping column. This is an AD-1
  amendment and must be accepted or rejected before any schema is written.
- Documents are the sharpest constraint: the storage key grammar is `{account_id}/...` and every
  policy compares that segment to `current_context_id()`, so cross-household file access is
  impossible regardless of RLS. Only two paths exist — a service-role Worker, or duplicating bytes.
- Shared-by-default **does** include records added later; there is no snapshot step. This is the
  deliberate opposite of AD-21's `listings` semantics, and a builder must not copy those reflexes.
- The archive mechanism for 13.2 already exists and already fails closed. The entire gap is an
  **actor**: every query in `remove_persona()` is filtered to `user_id = auth.uid()`, deliberately,
  so nobody can remove anybody but themselves — which is why a person who has died cannot be
  removed at all.

---

## References

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, and proposed FR120–FR125.
- `_bmad-output/implementation-artifacts/13-1-sharing-a-child-across-two-households.md` — §2 (what
  was established), §3 (E13-D1 to E13-D10), §5 (the AD-1 amendment).
- `_bmad-output/implementation-artifacts/13-2-when-someone-leaves-the-household.md` — §2 (the app
  does not ask why), §3 (E13-D11 to E13-D15), §4 (what already exists).
- `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/decisions-log.md` — the PRD-level
  decisions log this file follows in form; **D11** (*"One account = one household"*) is the
  decision Story 13.1 is the first real pressure on.
