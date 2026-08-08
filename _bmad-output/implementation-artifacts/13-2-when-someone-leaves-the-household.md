# Story 13.2: When someone leaves the household

Status: **ready-for-dev** *(unblocked 2026-08-09 — see the amendment below).* **This is the first
story of Epic 13.**

## Unblocked — 2026-08-09

Two changes, neither of which answers a product question on the owner's behalf.

**1. All five of its decisions now default.** E13-D11 through E13-D15 each carry a
`DEFAULT IF SILENT` in `epic-13-open-decisions.md` — four of them the recommendation this file
already made, verbatim. The story dispatches on those; an owner override changes one behaviour, not
the plan.

**2. AC-8's coupling is moved out, not weakened.** *"Removing a person, and whether they keep
access to a child, are one act with two questions"* is now **Story 13.4**
(`13-4-one-act-two-questions.md`), which depends on this story and on 13.3. The old handling was
for this story to ship a degraded version of the promise if 13.1 slipped; moving it is better,
because a permission question with no permission mechanism behind it does not belong in acceptance
criteria at all. **E13-D15's first half stays here and ships here:** removal ends a household
membership and never touches the person's login, because a login may carry memberships of contexts
this household has nothing to do with.

**One obligation travels with E13-D14's default.** The default hides archived people behind a
control labelled "past", which reverses Story 2.5's shipped AC-8 — so
`2-5-persona-lifecycle-changes.md` and the reasoning comment at `SingleCard.tsx:23-25` are amended
in the **same dispatch as this story**, by the same agent. Never split "change the decision" from
"update the story that describes it" (`.claude/rules/parallel-ownership.md` — this project's
three-times-repeated failure). If the owner overrides D14, that amendment is simply not made.

**What this story still is, unchanged:** the first function in the product that acts on a person
other than the caller, and therefore a mandatory security review. And the constraint that outranks
everything else in it is untouched by all of the above — the interface never names a reason and
never offers one to choose from.

---

*Original status line, kept as history:* **specification — not ready for dev.** Five product
questions are open (see §3), and one of them (§3.5) is coupled to Story 13.1. The mechanism this
story needs mostly exists; what does not exist is the ability for one person to do it on behalf of
another, and the answers to §3.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone holding a family's records,
I want to be able to say that a person is no longer part of this household — once, plainly,
without being asked to explain —
so that the app stops treating them as present, and still remembers them, because everyone else's
history is full of them.

## Position in Epic 13

**2nd of 2.** Independent of Story 13.1 in mechanism and buildable first; placed second because
13.1 settles the larger question of cross-household access and one branch of this story
(§3.5 — the person who leaves but keeps access to a child) is 13.1's grant, not a separate thing.
See "What this story cannot promise without 13.1" below.

## 1. Why the record survives

Not for data integrity. Not because a foreign key would break. Those are true and they are not
the reason.

The reason is that a person does not stop having been in a family. A brother's shidduch history
still mentions his sister — she is in the notes, she is why a particular shadchan was called, she
is half of the reason a reference said what they said. References who were spoken to years ago
still refer to her, by name, in a conversation log that is now about somebody else. Her mother
may want to look back at those months. A family that loses a daughter, or a marriage, or a child
who has moved on, does not want an app that quietly makes her never have existed.

So: **archive, never erase.** And it must be undoable, because the moment somebody does this is
the worst possible moment to make an irreversible decision, and because sometimes people are
wrong about what has happened.

This is already the product's posture — FR82 (*"Removing a persona archives, never deletes;
history remains auditable"*) and AD-2 (*"removing one **archives**, never deletes"*). This story
does not invent it. It extends it from "the thing you do to your own persona" to "the thing that
happens when a person leaves", and it fixes the fact that today only the person themselves can do
it.

## 2. The app does not ask why

**Hard constraint from the owner. It survives into the acceptance criteria and it is not
negotiable at build time.**

There is one neutral action. The interface never names a reason, never offers a list to choose
from, never has an optional "reason" field, never has a free-text "tell us what happened" box,
and never varies its wording by circumstance.

A partner leaving, a child moving out, a person who has died — the same one action, the same
words on screen, the same confirmation. Nobody should have to classify a bereavement to complete
a form. Nobody should have to scroll past "Divorce" and "Death" to find the option that fits.
Nobody should have to tell an app that their wife died in order to stop it emailing her
reminders.

This is not the same as "make the reason field optional". An optional field still asks. The
question is not asked.

**What this rules out, concretely, so it cannot come back as a well-meaning enhancement:**

- No `reason`, `removal_reason`, `left_because` or equivalent column — not nullable, not
  free-text, not an enum. If it does not exist, no future screen can start collecting it.
- No branching copy: no "Sorry for your loss", no "We're sorry to hear that", no bereavement
  path, no divorce path. One flow.
- No analytics event carrying a reason, and no support-facing distinction between kinds of
  departure.
- No differently-worded confirmation depending on the person's role or the household's shape.

The one thing the app may ask is the thing it needs to know to act correctly, and it is not a
reason: **does this person keep access to a child?** (§3.5). That is a question about permissions,
phrased as a permission, and it is asked in permission language.

## 3. What still needs a decision — product calls, not engineering ones

### 3.1 What happens to a removed person's open shidduchim?

Established: the pipeline does not currently have a state for this. `pipeline_state` is the one
canonical enum of seven (`new · look_into · not_sure · for_sure_not · yes · unsure · no`,
`01_tables.sql` + AD-4), and *"decision states are reachable **only** from `look_into`"*
(`enforce_pipeline_transition()`, `02_functions.sql:1526`). None of the seven means "this stopped
for a reason that is not about this shidduch". `for_sure_not` and `no` both mean *we decided
against this person* — which would be a lie written into the record of a shadchan who did nothing
wrong, and would corrupt the shadchan's own statistics (`shadchan_stats` counts
`nb_reached_yes` / `nb_progressed` off exactly these states).

**Decision needed.** Three shapes, none free: (a) leave them exactly as they are, open forever,
visible in the board — honest, but the board now shows work nobody will do; (b) an eighth
pipeline state, which is an AD-4 amendment and touches the transition guard, the board, the
summary views and the shadchan stats; (c) leave the state alone and let the *single's* archived
status carry it, so the shidduchim are still `look_into` but their single is archived and they
fall out of the working board with their history intact. **(c) is the recommendation** — it adds
no state, tells no lie about any shadchan, and matches the existing shape where the single's
status is the fact and the shidduchim hang off it. But it depends on §3.4's answer about lists.

### 3.2 Do they still appear in a sibling's record, in past redts, in reference history?

**Almost certainly yes — and it is worth confirming out loud, because it is the whole reason for
archiving rather than deleting.** That history is about other people too. A reference call logged
against a sister's shidduch is a record of what a real person said on a real day; it does not
become false when she leaves. A redt is an event that happened. A note in a brother's file that
mentions her is his note.

Established: nothing in the schema would remove any of it. `interactions`, `redts`,
`reference_links.conversation_log` and every note carry no reference to the departed person's row
that archiving would sever, and `purge_polymorphic_dependents()` (`02_functions.sql:2485`) fires
only on a **hard delete**, which this story never performs.

**Decision needed, and it is narrower than it looks:** not *whether* they appear, but *how they
read*. Does a mention of an archived person carry a visible marker, or does it read exactly as it
did? A marker is honest and may also be a small unkindness every time somebody opens the file.
Recommendation: mark the person's own record, not every mention of them.

### 3.3 How does undo work, and for how long?

Established: **the product has no un-archive path anywhere.** `remove_persona()`'s own guard
comment says it in writing — *"there is no un-archive path today"*
(`02_functions.sql:928-945`) — and that absence is load-bearing in the existing code:
`guard_persona_removal()` refuses to archive a last remaining membership *specifically because*
`add_persona()` would then mint a brand-new empty account rather than reactivating the archived
one, making the household's history permanently unreachable. The `singles` status select in the
edit form disables `archived` outright so it *"can never be chosen going the other way"*
(`SingleInputs.tsx:41-53`).

So undo is genuinely new work, not a toggle.

**Decision needed.** Is it (a) unlimited — an archived person can be restored at any time by
anyone who could have removed them; (b) time-boxed — a window of days after which it needs
support; or (c) unlimited but quiet, restorable only from the archived person's own record rather
than offered as a banner? **Recommendation: (a), unlimited.** A time limit exists to protect the
system from something; nothing here needs protecting from a family changing its mind two months
later, and a deadline on undoing a bereavement notice is a cruelty with no compensating benefit.

### 3.4 Do they appear in lists by default, or only when looking back deliberately?

Established, and this is the surprising one: **archived singles appear in the roster today, by
design, and this was a deliberate decision in Story 2.5.** `SingleList.tsx` applies no status
filter at all; `singles_summary` (`03_views.sql:201-221`) selects `c.status` but never filters on
it; and `SingleCard.tsx:23-25` carries the reasoning in a comment — *"2.5 AC-8: this roster keeps
showing archived singles (the full family record, not just the active ones), so the status pill
must say 'Archived'"*.

So the current answer is "yes, always, with a pill". That was decided for a household with one
self-archived persona. It is a different question for a family whose daughter has died, who will
now see her name in the list every single time they open the app.

**Decision needed, and this is the one most worth thinking about as a person.** Options: keep the
current always-visible behaviour (the family record is the family record); hide archived people
behind a deliberate "show past members" control (they are there when you go looking, not when you
are working); or make it the household's own choice. **Recommendation: hidden by default, one
obvious control to see them, and the control's label says "past" rather than "archived"** — but
this reverses a shipped, deliberate decision and therefore belongs to the owner, not to a
builder. Note it also changes 2.5 AC-8's meaning, and per `.claude/rules/parallel-ownership.md`
("A shared decision has exactly one owner") that amendment must be recorded here and applied to
`2-5-persona-lifecycle-changes.md` in the same dispatch, never split across two agents.

### 3.5 If the person had a login, are removing the person and revoking access one action or two?

Established: they are currently **two different tables and two different meanings**, and neither
is reachable by anyone but the person themselves.

- `account_members.status ∈ ('active','archived')` — membership of *this household*. Archiving it
  removes them from the context: `current_context_id()` requires `am.status = 'active'`
  (`02_functions.sql:249-269`), so an archived member's active context resolves to NULL and every
  RLS policy fails closed. This is what `remove_persona()` writes.
- `members.disabled` — the login itself, across the whole product
  (`01_tables.sql:71-80`, surfaced in `MemberInputs.tsx:25`). A person may be a member of more
  than one household (AD-2: *"a login may hold memberships of several contexts simultaneously"*),
  so disabling their login because they left *one* household would cut them off from a shadchanus
  context or their own record that has nothing to do with this family.

**Decision needed:** the recommendation is **two outcomes from one act, not two acts**. One
neutral action removes the person from this household; their login is untouched, because it is
not this household's to disable. And — the coupling to Story 13.1 — the same action asks the one
permission question §2 permits: **does this person keep access to a child?**

## 4. What already exists — do not build a parallel mechanism

The mechanism is mostly here. What is missing is one specific thing.

**What exists:**

| Piece | Where | What it does |
| --- | --- | --- |
| Archive a membership | `remove_persona()`, `02_functions.sql:982-1145` | `update account_members set status='archived'` — its own comment: *"the only writes in this body are `update … set status = 'archived'` or `update … set role = 'self_manager'` — zero `delete from`"* |
| Archive a single | same function, `:1067` | `update singles set status='archived'` |
| The archived state | `account_members_status_check`, `01_tables.sql:279-281` | `status in ('active','archived')` |
| Fail-closed effect of archiving | `current_context_id()`, `:249` | archived membership → NULL context → every policy denies |
| Guards against orphaning a household | `guard_persona_removal()`, `:946`; `account_has_domain_data()`, `:908` | refuses to archive the last active member of an account that still holds records |
| Guard against orphaning children | `remove_persona()`'s parent branch, `:1085-1103` | refuses when other active singles remain and no other `parent_admin` would |
| Handing off the active context | `remove_persona()`, `:1122-1145` | re-activates another membership, or clears to NULL |
| Human error copy for every guard | `PersonasSection.tsx:14-53` | each guard message mapped to a plain sentence — *"You're the only one who can still reach this account's records — add another member before removing this."* |
| Merging duplicate people | `merge_references()`, `:3055`; `preview_reference_merge()`, `:2970` | the precedent for a reversible-shaped, preview-then-commit operation on a person record |

**What is missing — and it is the entire gap:** `remove_persona()` is **self-service only**. Every
query in it is filtered to `user_id = auth.uid()`, deliberately, and its own comment says why:
*"every query is filtered to `user_id = auth.uid()` alone, never a parameter, so bypassing RLS
never becomes bypassing the tenant boundary."* There is **no path anywhere in the product** for a
`parent_admin` to archive another person — not another member, not another member's single.

That constraint was correct for Story 2.5 and it is exactly what has to change here, carefully:
the new function takes a target, so the check that `remove_persona()` gets for free (you can only
ever reach yourself) has to be written explicitly and cannot be inherited.

**And the case that has no mechanism at all:** the person who has died. They cannot remove their
own persona. There is no bereavement path today, there should not be a bereavement *path*
(§2 — one neutral action), but there must be a way for the family to do it, and today there is
not one.

## 5. Acceptance Criteria

1. **One neutral action, and the app does not ask why.** **Given** a person in my household,
   **when** I remove them, **then** I am asked to confirm, and at no point am I asked, offered,
   or given the option to state a reason. The confirmation reads the same whether the person has
   moved out, left a marriage, or died. **Failing looks like:** a `reason` column of any kind in
   the migration; a select, radio group or text input in the dialog; branching copy anywhere in
   the flow; or an analytics event with a reason property. A grep of the story's own diff for
   `reason` should return only `close_reason` (a pre-existing, unrelated column).

2. **A household admin can remove someone other than themselves — and only within their own
   household.** **Given** I am a `parent_admin`, **when** I remove another member, **then** it
   succeeds, and **when** the same call names a person in a household I am not an active member
   of, **then** it is refused by the database. This is the one place `remove_persona()`'s
   free-of-charge safety (`user_id = auth.uid()`) is given up, so the replacement check is
   explicit and tested. **Failing looks like:** any `SECURITY DEFINER` function that takes a
   target id and does not re-derive the caller's own membership from `auth.uid()` before acting;
   or a negative test written as two disjoint users rather than **one login, two contexts, active
   in one** [Source: `epic3-api-contract.md#13` — rule 3].

3. **Nothing is erased.** **Given** a person is removed, **when** the migration and the function
   are examined, **then** neither performs a `delete from` against any table, and every record
   that mentions them still exists and still reads. Their name in a sibling's notes, in a redt,
   in a reference conversation log, is untouched. **Failing looks like:** a `delete` anywhere in
   the diff; or a cascade fired by a hard delete of a `singles` or `account_members` row
   (`purge_polymorphic_dependents()`, `02_functions.sql:2485`, exists precisely to clean up after
   deletes this story must never perform).

4. **It is undoable.** **Given** a person has been removed, **when** someone who could have
   removed them restores them, **then** their membership, their record and their place in the
   household are exactly as they were — same row, same id, same history, not a re-created copy.
   **[BLOCKED: §3.3]** — for how long, and from where, is the open part; that it must be possible
   is not.

5. **Their history stays where it is, in everybody else's records.** **Given** a removed person,
   **when** I open a sibling's shidduch, a past redt, or a reference's call history, **then**
   every mention of them is present and unchanged. **[BLOCKED: §3.2]** — whether their own record
   carries a visible marker.

6. **They stop being treated as present.** **Given** a removed person, **when** the app does
   anything that assumes a live participant, **then** it does not do it for them: no reminder is
   delivered to them, no task is assigned to them, they are not offered in a member picker, and
   no notification is addressed to them. This is the bereavement case in its most concrete form —
   an app that keeps emailing a person who has died is the specific harm this AC exists to
   prevent. **Note the deliberate exception, which is Story 12.3's shipped ruling and must not be
   reversed here:** *"archiving a member leaves their tasks listed, completable and
   reassignable"* (12.3 AC-5). Their work stays visible so somebody can pick it up; only delivery
   to them stops.

7. **Removing a person from a household does not disable their login.** **Given** a person who is
   a member of this household and also holds another context, **when** they are removed here,
   **then** `members.disabled` is untouched and their other memberships still work. A household
   may end its own relationship with a person; it may not end that person's account.

8. **Removing a person, and whether they keep access to a child, are one act with two questions —
   never one collapsed decision.** **[BLOCKED: §3.5, and coupled to Story 13.1]** — see below.

9. **The existing guards still hold, with their existing words.** **Given** any removal, **when**
   it would leave a household with records nobody can reach, or with singles nobody administers,
   **then** it is refused with the plain-language message that already exists
   (`PersonasSection.tsx:14-53`), not a raw Postgres error. `guard_persona_removal()` and the
   parent branch's other-admin check are reused verbatim, not reimplemented for the
   remove-someone-else path.

10. **The word "archived" does not have to appear on screen.** The database's vocabulary is
    `archived`; the interface's does not have to be. "No longer in this household", "past
    members" — the schema's word is a schema word. **[Relates to §3.4]**

## What this story cannot promise without 13.1

AC-8 says removing a person and deciding whether they keep access to a child are one act with two
questions. The second question only has a meaningful answer if per-child cross-household access
exists — which is Story 13.1, and 13.1 is blocked on ten product decisions and an architecture
amendment.

If 13.1 is deferred, **say what AC-8 degrades to rather than shipping it silently weakened**:
"keeps access" would mean "keeps their household membership", which hands them the whole
household — every other child, the shadchan book, the inbox, the reminders — and is precisely
the thing 13.1 exists to avoid. That is not a smaller version of AC-8; it is a different and
worse promise. The honest interim is to ship this story **without** the access question, as a
plain removal, and add the question when 13.1 lands.

## 6. Tasks / Subtasks

Not written as an implementation plan; five decisions in §3 change what gets built. What is
recorded is the order the work has to fall in:

- [ ] **Decision pass (owner).** §3.5 first (one act or two — it determines whether this story
      waits on 13.1). Then §3.4 (lists — it reverses a shipped decision and needs the 2.5
      amendment recorded), §3.3 (undo), §3.1 (open shidduchim), §3.2 (mentions).
- [ ] **The removal function.** A single new `SECURITY DEFINER` function that takes a target and
      re-derives the caller's own active membership from `auth.uid()` — reusing
      `guard_persona_removal()`, `account_has_domain_data()` and the parent branch's other-admin
      check, never reimplementing them. `remove_persona()` itself is not modified: it is the
      self-service path and stays correct as it is.
- [ ] **The restore function**, whose shape depends on §3.3. `merge_references()`'s
      preview-then-commit pattern (`02_functions.sql:2970`, `:3055`) is the in-repo precedent for
      a consequential operation on a person record that shows its consequences first.
- [ ] **Delivery suppression** for AC-6 — and only delivery. 12.3 AC-5's "tasks stay listed,
      completable and reassignable" is a shipped ruling; the change is to who receives, not to
      what is listed.
- [ ] **The interface**, built against §2's constraint. Review it by reading the screen out loud
      as though to someone whose child died last week. If any sentence would land badly, it is
      the wrong sentence.
- [ ] **Security review is mandatory** — `.claude/rules/security-triggers.md`: authorization,
      database queries, migrations, RLS. Specifically: this story creates the product's first
      function that acts on a person other than the caller.
- [ ] **`make check-migration-safety`** — the only gate that runs a migration against a row
      (AGENTS.md, "The empty-table trap"). A story about not erasing people must not erase
      anybody's row through a careless migration.

## 7. Dev Notes

### Why this is not a new archive mechanism

The temptation is a `household_departures` table with its own lifecycle. Refuse it. Archiving
already exists, it already fails closed (`current_context_id()` requires `status = 'active'`), it
already has guards, and it already has a vocabulary the schema uses consistently. What is missing
is not a mechanism; it is **an actor** — the ability for one person to do to another what
`remove_persona()` already does to the caller. Building a second archive concept alongside the
existing one is the exact defect `.claude/rules/parallel-ownership.md` describes as *"two agents
solving the same problem by different mechanisms"*, arriving through a single story instead of a
wave.

### The two archives are different things and must not be conflated

`account_members.status = 'archived'` means *this person is no longer in this household*.
`singles.status = 'archived'` means *this person is no longer being redt for*. They are
independent and both may apply. A mother removing herself keeps her daughter's `singles` row
active. A daughter who has married is `singles.archived` while her mother's membership is
untouched. `remove_persona()` already keeps them separate across its three branches; the new
remove-someone-else path must too.

Note the third case the current code has no branch for: a person who is **both** — a member with
a login and a `singles` row pointing at themselves via `singles.member_id` (the self-manager
shape, FR87/D11). Removing them touches both tables. `remove_persona()`'s parent branch handles
the self-service version by demoting to `self_manager` rather than archiving
(`02_functions.sql:1104-1107`); a removal *by someone else* has no equivalent and needs one
designed rather than inferred.

### On the copy that goes on screen

Some specific things not to write, for the same reason as in 13.1:

- Not "deactivate", "disable", "deprovision", "terminate", or anything from the account-management
  register. This is a person, not a seat.
- Not "delete" — the app is not deleting them and should not say a word it does not mean.
- Not "Are you sure? This cannot be undone", which is both false (AC-4) and a sentence to make
  somebody's hands shake.
- Not "former", "ex-", or any term that classifies the relationship. §2.

What is fine: *"Remove from this household"*, *"They'll stay in your family's records"*,
*"You can undo this."* Short, true, and it does not ask.

### Precedent index — read these before designing

| Question | Where the answer already exists |
| --- | --- |
| Archive without deleting | `remove_persona()`, `02_functions.sql:982` (and its "zero `delete from`" comment) |
| Refusing to orphan a household | `guard_persona_removal()` + `account_has_domain_data()`, `:946`, `:908` |
| Handing off an active context | `remove_persona()`'s AC-7 block, `:1122-1145` |
| Guard messages as human sentences | `settings/PersonasSection.tsx:14-53` |
| Preview-then-commit on a person record | `preview_reference_merge()` / `merge_references()`, `:2970`, `:3055` |
| Archived people already shown in lists | `SingleCard.tsx:23-25`, `SingleList.tsx`, `singles_summary` (`03_views.sql:201`) |
| Archived status locked out of the edit form | `SingleInputs.tsx:41-53` |
| Tasks survive a member being archived | Story 12.3 AC-5 |

## 8. References

- `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`
  — AD-2 (*"removing one archives, never deletes"*), AD-15 (data lifecycle), AD-19 (active
  context), AD-4 (the one canonical `pipeline_state`).
- `_bmad-output/planning-artifacts/epics.md` — FR82 (*"Removing a persona archives, never deletes;
  history remains auditable"*), Story 2.5, Story 12.3.
- `supabase/schemas/01_tables.sql` — `members` (:71), `account_members` (:258, and
  `account_members_status_check` at :279), `singles` (:333, and note `status` carries **no** check
  constraint), `interactions` (:757), `redts` (:704).
- `supabase/schemas/02_functions.sql` — `current_context_id()` (:249), `account_has_domain_data()`
  (:908), `guard_persona_removal()` (:946), `remove_persona()` (:982),
  `enforce_pipeline_transition()` (:1526), `preview_reference_merge()` (:2970),
  `merge_references()` (:3055), `purge_polymorphic_dependents()` (:2485).
- `supabase/schemas/03_views.sql` — `singles_summary` (:201), `shadchan_stats` (:250).
- `src/components/atomic-crm/settings/PersonasSection.tsx`,
  `src/components/atomic-crm/singles/SingleCard.tsx`,
  `src/components/atomic-crm/singles/SingleInputs.tsx`.
- `_bmad-output/implementation-artifacts/2-5-persona-lifecycle-changes.md` — AC-8, the shipped
  decision §3.4 would amend.
- `_bmad-output/implementation-artifacts/12-3-family-shared-tasks.md` — AC-5, the shipped ruling
  AC-6 must not reverse.

## Dev Agent Record

### Agent Model Used

_(not yet implemented)_

### Debug Log References

_(not yet implemented)_

### Completion Notes List

_(not yet implemented)_

### File List

_(not yet implemented)_
